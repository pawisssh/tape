// @ts-check
/// <reference path="../../types/index.js" />
/// <reference path="../../types/obsidian.js" />

// Local LLM summary enrichment (Phase 4). See PLAN.md §6 Phase 4 / §8 — this file
// enforces the single most important correctness property in the whole project: ANY
// failure (server unreachable, network error, timeout/abort, non-2xx HTTP, unparseable
// JSON, empty response, or any unexpected thrown error at all) must silently resolve to
// `null`, never throw and never be treated as something the caller has to catch. The
// caller (handoff.js) treats `null` as "skip enrichment, build the plain Phase-3
// markdown note" — the raw transcript export must never depend on this succeeding.
//
// The ONE deliberate exception to "always resolve to null on failure" is a context-window
// mismatch: if the transcript clearly needs more tokens than the model is currently loaded
// with, enrichWithLlm resolves to a distinct `{contextExceeded: true, ...}` shape instead
// of `null`, and the caller (obsidian-handoff) surfaces this as a blocking, retryable error
// with the actual numbers — rather than silently falling back to a plain note the user
// didn't ask for and may not notice is missing its summary. Every other failure mode still
// falls back to `null` as before.
//
// The pure helpers below (extractJsonFromResponse, endpointOriginPattern, estimateTokenCount)
// have no chrome.*/network dependency and are unit-tested directly in tests/llm.test.mjs.
// enrichWithLlm and getLoadedContextLength are the only functions here that touch the network.
// Template resolution (Properties/Note-content -> resolved output) lives in
// extension/obsidian/interpreter.js — see its own tests/interpreter.test.mjs.

import { getMeetingTitle } from "./markdown.js"
import { resolveTemplateForTitle, migrateLegacyTemplate, resolveDefaultTemplate } from "./templates.js"
import {
    collectInstructions,
    buildInterpreterUserPrompt,
    buildInstructionAnswers,
    resolveValue,
    resolvePropertyValue,
    getMeetingVariables,
    templateReferencesVariable,
} from "./interpreter.js"

// Note: there is no DEFAULT_LLM_ENDPOINT/DEFAULT_LLM_MODEL here (there was, pre-multi-
// provider) — obsidianLlmEndpoint/obsidianLlmModel are now always resolved by
// store.js's getObsidianSettings() from the active provider+model (see providers.js),
// and an empty string genuinely means "nothing configured yet," not "unset, so fall back
// to a hardcoded LM Studio default." Falling back here would silently fire a request at
// localhost even when the user has never configured a provider at all. See
// PROVIDER_PRESETS in providers.js for the actual per-provider defaults now.

/** @type {ObsidianLlmTimeoutMs} */
export const DEFAULT_LLM_TIMEOUT_MS = 600000

// Timeout for the best-effort "what context is this model loaded with?" pre-flight check
// (see getLoadedContextLength below) — independent of the main DEFAULT_LLM_TIMEOUT_MS
// budget. This is a lightweight metadata GET, not a generation request, so it gets a much
// shorter budget of its own.
const MODEL_INFO_TIMEOUT_MS = 10000

// Rough characters-per-token ratio for estimateTokenCount() — the standard approximation
// for English text (used e.g. by OpenAI's own sizing guidance). This is intentionally not
// real tokenization: the tool supports arbitrary local models/servers with no shared
// tokenizer, and the estimate only feeds the context-window mismatch check above — a
// rough-but-conservative number is all that's needed there, not exact token accounting.
const CHARS_PER_TOKEN_ESTIMATE = 4

// The old fixed SYSTEM_PROMPT/buildUserPrompt/renderSummaryMarkdown pipeline that used
// to live here has been replaced by extension/obsidian/interpreter.js's
// INTERPRETER_SYSTEM_PROMPT/buildInterpreterUserPrompt/buildInstructionAnswers — see
// enrichWithLlm() below. Every meeting now resolves through a SummaryTemplate (either a
// user-defined one or templates.js's built-in DEFAULT_TEMPLATE), whose `properties` and
// `noteContent` are interpreter.js template strings.

/**
 * Strip a leading/trailing ```` ``` ```` or ```` ```json ```` fence, if present, and
 * return the inner content. Returns the input unchanged if no fence is found.
 * @param {string} text
 * @returns {string}
 */
function stripCodeFence(text) {
    const fenced = text.match(/```(?:json|JSON)?\s*([\s\S]*?)```/)
    return fenced ? fenced[1] : text
}

/**
 * Scan `text` for the first balanced top-level `{...}` object, respecting string
 * literals (so a `}` inside a quoted string doesn't end the scan early) and backslash
 * escapes within those strings. Returns the substring including both braces, or `null`
 * if no balanced object is found (e.g. truncated output missing a closing brace).
 * @param {string} text
 * @returns {string | null}
 */
function extractBalancedJsonObject(text) {
    const start = text.indexOf("{")
    if (start === -1) {
        return null
    }

    let depth = 0
    let inString = false
    let escaped = false

    for (let i = start; i < text.length; i++) {
        const ch = text[i]

        if (inString) {
            if (escaped) {
                escaped = false
            } else if (ch === "\\") {
                escaped = true
            } else if (ch === '"') {
                inString = false
            }
            continue
        }

        if (ch === '"') {
            inString = true
        } else if (ch === "{") {
            depth++
        } else if (ch === "}") {
            depth--
            if (depth === 0) {
                return text.slice(start, i + 1)
            }
        }
    }

    // Ran off the end of the string with unclosed braces — truncated/malformed output.
    return null
}

/**
 * Extract and parse a single JSON object from raw LLM output, tolerating the real-world
 * quirks local models produce: `<think>...</think>` reasoning blocks, ` ```json ` code
 * fences, and chatty pre/postamble text surrounding the actual object. Never throws —
 * any failure to find/parse a plain JSON *object* (as opposed to e.g. a bare array or
 * string, which do not match the required schema) returns `null`.
 * @param {string | null | undefined} rawText
 * @returns {Object | null}
 */
export function extractJsonFromResponse(rawText) {
    if (typeof rawText !== "string" || rawText.trim() === "") {
        return null
    }

    try {
        let text = rawText.replace(/<think>[\s\S]*?<\/think>/gi, "")
        text = stripCodeFence(text).trim()

        // Fast path: the whole (fence-stripped) text is already valid JSON.
        let candidate = text
        let parsed
        try {
            parsed = JSON.parse(candidate)
        } catch {
            // Fall back to scanning for a balanced {...} object anywhere in the text,
            // which tolerates chatty preamble/postamble around the JSON.
            candidate = extractBalancedJsonObject(text)
            if (candidate === null) {
                return null
            }
            parsed = JSON.parse(candidate)
        }

        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            // Schema requires a plain object — a bare array or string response doesn't
            // match it, even though it may be syntactically valid JSON.
            return null
        }

        return parsed
    } catch {
        return null
    }
}

/**
 * @param {unknown} value
 * @returns {string | undefined} the trimmed string, or undefined if not a non-empty string
 */
function asNonEmptyString(value) {
    if (typeof value !== "string") {
        return undefined
    }
    const trimmed = value.trim()
    return trimmed === "" ? undefined : trimmed
}

/**
 * Derive the origin match pattern (for `chrome.permissions.request`) from a configured
 * LLM endpoint URL, e.g. "http://localhost:1234/v1/chat/completions" ->
 * "http://localhost/*". Chrome match patterns have no port component — any port on the
 * host is implicitly covered — matching the pattern already used for webhook URLs in
 * extension/meetings.js. Returns null if the endpoint isn't a parseable URL.
 * @param {string} endpoint
 * @returns {string | null}
 */
export function endpointOriginPattern(endpoint) {
    try {
        const url = new URL(endpoint)
        return `${url.protocol}//${url.hostname}/*`
    } catch {
        return null
    }
}

/**
 * Rough token-count estimate for arbitrary text (see CHARS_PER_TOKEN_ESTIMATE above for
 * why this isn't real tokenization). Never throws on non-string input.
 * @param {string} text
 * @returns {number}
 */
export function estimateTokenCount(text) {
    if (typeof text !== "string" || text.length === 0) {
        return 0
    }
    return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE)
}

/**
 * `requiredTokens` (the prompt's own estimated size) plus headroom for the model's own
 * response on top of it, rounded up to the nearest 1024 — a number a user can actually
 * type into LM Studio's Context Length field. This is both the number `enrichWithLlm`
 * actually checks the provider's context window against (a bare prompt-only estimate
 * would leave no room for the model to generate anything, since requests here don't set
 * `max_tokens`) and the number `ContextExceededDialog.tsx` suggests the user raise their
 * context length to — the same calculation, not two that could drift apart.
 * @param {number} requiredTokens
 * @returns {number}
 */
export function suggestedContextWindow(requiredTokens) {
    return Math.ceil((requiredTokens * 1.15) / 1024) * 1024
}

/**
 * Best-effort check for whether a non-2xx completions response is specifically a
 * context-length/token-limit rejection, as opposed to any other failure (auth, malformed
 * request, model not found, server error, etc.). This is the fallback safety net for when
 * the pre-flight getModelContextInfo() check couldn't determine a ceiling in advance (a
 * non-LM-Studio provider, a model id LM Studio's /api/v0/models doesn't recognize, that
 * request timing out, etc.) — the transcript may still genuinely not fit, and the server
 * itself is the one authority that always knows for certain. llama.cpp-based servers (LM
 * Studio, text-generation-webui, koboldcpp) and OpenAI-compatible APIs generally surface
 * this as an error message containing wording like "context length"/"context window"/
 * "maximum context". Never throws — any failure to read the body resolves to `false`,
 * meaning "not detected as a context error," not "definitely isn't one."
 * @param {Response} response
 * @returns {Promise<boolean>}
 */
async function isContextLengthError(response) {
    try {
        const text = await response.text()
        return /context.{0,20}(length|window|size)|maximum context|too many tokens|token limit/i.test(text)
    } catch {
        return false
    }
}

/**
 * Wire an external, caller-owned AbortSignal into a request-local AbortController, so
 * aborting the external signal (e.g. a user clicking "Stop") also cancels this specific
 * fetch — without giving the caller direct access to the internal controller, which also
 * needs to self-abort on its own timeout independent of anything external. A no-op when
 * `externalSignal` is omitted (every call site here is used for both user-triggered
 * requests and internal-only ones, e.g. from a Retry that doesn't have a signal handy).
 * @param {AbortController} controller
 * @param {AbortSignal} [externalSignal]
 */
function bridgeExternalAbort(controller, externalSignal) {
    if (!externalSignal) {
        return
    }
    if (externalSignal.aborted) {
        controller.abort()
        return
    }
    externalSignal.addEventListener("abort", () => controller.abort(), { once: true })
}

/**
 * Best-effort read of `model`'s context info via LM Studio's native
 * `GET {origin}/api/v0/models/{model}` endpoint — two independently-optional signals:
 * `loadedContextLength` (the `loaded_context_length` field, present only while the model
 * is actually loaded into memory — the most accurate signal, since it's what the model is
 * *actually* running with right now) and `maxContextLength` (the `max_context_length`
 * field, the model's training-time ceiling — present regardless of load state, so it's
 * available even for a model LM Studio hasn't auto-loaded yet). This is an LM-Studio-
 * specific extension, not part of the OpenAI spec the rest of this file targets — on
 * Ollama or any other server, or if anything about this request goes wrong (unreachable,
 * timeout, non-2xx, unparseable body), both resolve to `null`, meaning "unknown — the
 * caller should skip whichever check(s) it can't do, not treat this as an error."
 * @param {string} endpoint the configured chat-completions endpoint
 * @param {string} model
 * @param {string} [apiKey]
 * @param {AbortSignal} [signal] external signal (e.g. a user-triggered Stop) — see bridgeExternalAbort()
 * @returns {Promise<{loadedContextLength: number | null, maxContextLength: number | null}>}
 */
async function getModelContextInfo(endpoint, model, apiKey, signal) {
    /** @type {string} */
    let origin
    try {
        origin = new URL(endpoint).origin
    } catch {
        return { loadedContextLength: null, maxContextLength: null }
    }

    const controller = new AbortController()
    const timeoutHandle = setTimeout(() => controller.abort(), MODEL_INFO_TIMEOUT_MS)
    bridgeExternalAbort(controller, signal)
    try {
        const response = await fetch(`${origin}/api/v0/models/${encodeURIComponent(model)}`, {
            headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
            signal: controller.signal,
        })
        if (!response.ok) {
            return { loadedContextLength: null, maxContextLength: null }
        }
        /** @type {any} */
        const body = await response.json()
        const loadedContextLength = body?.loaded_context_length
        const maxContextLength = body?.max_context_length
        return {
            loadedContextLength:
                typeof loadedContextLength === "number" && Number.isFinite(loadedContextLength) ? loadedContextLength : null,
            maxContextLength:
                typeof maxContextLength === "number" && Number.isFinite(maxContextLength) ? maxContextLength : null,
        }
    } catch {
        return { loadedContextLength: null, maxContextLength: null }
    } finally {
        clearTimeout(timeoutHandle)
    }
}

/**
 * Independent JSON transport for Live Assist. Obsidian enrichment below keeps
 * its existing interpreter and output contract.
 * @param {ObsidianSettings} settings
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @returns {Promise<{value: Object | null} | {contextExceeded: true, requiredTokens: number, loadedContextLength?: number} | null>}
 */
export async function requestLlmJson(settings, systemPrompt, userPrompt) {
    try {
        const endpoint = settings.obsidianLlmEndpoint
        const model = settings.obsidianLlmModel
        if (!endpoint || !model) return null
        const requiredTokens = estimateTokenCount(systemPrompt + "\n" + userPrompt)
        const info = await getModelContextInfo(endpoint, model, settings.obsidianLlmApiKey)
        const ceiling = info.loadedContextLength ?? info.maxContextLength
        if (ceiling !== null && suggestedContextWindow(requiredTokens) > ceiling) return { contextExceeded: true, requiredTokens, loadedContextLength: ceiling }
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), Math.min(settings.obsidianLlmTimeoutMs || 45000, 45000))
        try {
            const response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(settings.obsidianLlmApiKey ? { Authorization: `Bearer ${settings.obsidianLlmApiKey}` } : {}) },
                body: JSON.stringify({ model, temperature: 0.3, stream: false, messages: [
                    { role: "system", content: systemPrompt }, { role: "user", content: userPrompt },
                ] }),
                signal: controller.signal,
            })
            if (!response.ok) return await isContextLengthError(response) ? { contextExceeded: true, requiredTokens } : null
            const body = await response.json()
            const content = body?.choices?.[0]?.message?.content
            return typeof content === "string" ? { value: extractJsonFromResponse(content) } : null
        } finally {
            clearTimeout(timer)
        }
    } catch {
        return null
    }
}

/**
 * OpenAI-compatible text transport for transcript chat. Unlike requestLlmJson(), this
 * intentionally preserves Markdown and other natural-language formatting in the model
 * response. It follows enrichWithLlm()'s failure contract: network/provider failures
 * resolve to null, context overflow gets an actionable shape, and an externally aborted
 * request reports stopped instead of looking like a provider failure.
 * @param {ObsidianSettings} settings
 * @param {{role: "system" | "user" | "assistant", content: string}[]} messages
 * @param {AbortSignal} [signal]
 * @returns {Promise<{value: string} | {contextExceeded: true, requiredTokens: number, loadedContextLength?: number} | {stopped: true} | null>}
 */
export async function requestLlmText(settings, messages, signal) {
    try {
        const endpoint = settings.obsidianLlmEndpoint
        const model = settings.obsidianLlmModel
        if (!endpoint || !model || messages.length === 0) return null

        const promptText = messages.map((message) => `${message.role}: ${message.content}`).join("\n")
        const requiredTokens = estimateTokenCount(promptText)
        const info = await getModelContextInfo(endpoint, model, settings.obsidianLlmApiKey, signal)
        if (signal?.aborted) return { stopped: true }
        const ceiling = info.loadedContextLength ?? info.maxContextLength
        if (ceiling !== null && suggestedContextWindow(requiredTokens) > ceiling) {
            return { contextExceeded: true, requiredTokens, loadedContextLength: ceiling }
        }

        const controller = new AbortController()
        const timeoutHandle = setTimeout(() => controller.abort(), settings.obsidianLlmTimeoutMs || DEFAULT_LLM_TIMEOUT_MS)
        bridgeExternalAbort(controller, signal)
        /** @type {Response} */
        let response
        try {
            response = await fetch(endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(settings.obsidianLlmApiKey ? { Authorization: `Bearer ${settings.obsidianLlmApiKey}` } : {}),
                },
                body: JSON.stringify({ model, temperature: 0.2, stream: false, messages }),
                signal: controller.signal,
            })
        } catch {
            return signal?.aborted ? { stopped: true } : null
        } finally {
            clearTimeout(timeoutHandle)
        }

        if (!response.ok) {
            if (await isContextLengthError(response)) return { contextExceeded: true, requiredTokens }
            return null
        }

        /** @type {any} */
        const body = await response.json()
        const content = body?.choices?.[0]?.message?.content
        if (typeof content !== "string") return null
        const value = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim()
        return value ? { value } : null
    } catch {
        return signal?.aborted ? { stopped: true } : null
    }
}

/**
 * Call the configured local LLM server (if the matched template has any AI
 * instructions at all — an all-variables template skips the network call entirely) and
 * resolve the matched SummaryTemplate's `properties`/`noteContent` against the result,
 * ready to be injected into buildMarkdown() via `resolvedProperties`/`summaryMarkdown`/
 * `overrideTitle`. This and getLoadedContextLength above are the only functions in this
 * file that touch the network — every other export is a pure helper.
 *
 * Non-negotiable: this function must never throw and must never reject. Almost every
 * failure mode (server unreachable, DNS failure, missing host permission, non-2xx
 * response, timeout/abort, an unparseable or empty response body, or any other
 * unexpected error) resolves to `null`. The caller treats `null` as "skip enrichment,
 * fall back to the plain Phase-3 markdown" and never needs a try/catch of its own around
 * this call.
 *
 * The one exception: if this transcript is estimated to need more context than the model
 * can provide, this resolves to a distinct `{contextExceeded: true, requiredTokens,
 * loadedContextLength?}` shape instead — a deliberately actionable, user-fixable condition
 * (reload the model in LM Studio with more context) that the caller surfaces as a
 * blocking, retryable error rather than silently dropping the summary. This is detected two
 * ways: (1) a pre-flight check, comparing the buffered estimate against whichever of the
 * model's *currently loaded* context (most accurate) or its *maximum* context (fallback,
 * used when LM Studio hasn't auto-loaded the model yet — see getModelContextInfo()'s own
 * doc comment) is available — `loadedContextLength` in the returned shape is that chosen
 * ceiling when this path is what caught it; or (2) a fallback, when the pre-flight check
 * found no ceiling to compare against at all (non-LM-Studio provider, unrecognized model
 * id, that request timing out, etc.) and the real request goes out anyway — if the server
 * itself then rejects it with wording indicating a context/token-limit problem (see
 * isContextLengthError()), that's just as authoritative and gets caught here too, with
 * `loadedContextLength` omitted (no reliable number to report from server prose alone).
 *
 * A second, distinct exception: if `signal` is passed and gets aborted (e.g. the user
 * clicked "Stop") while a network request is in flight, this resolves to `{stopped: true}`
 * instead of `null` — the caller treats this as a hard stop of the whole operation, not
 * "LLM unavailable, fall back to the plain transcript" (which is what a bare `null` still
 * means for every other failure, including this function's own internal timeout aborting
 * the request — only an externally-aborted `signal` produces `{stopped: true}`).
 * @param {Meeting} meeting
 * @param {ObsidianSettings} settings
 * @param {AbortSignal} [signal] external signal (e.g. a user-triggered Stop) — see bridgeExternalAbort()
 * @returns {Promise<{title?: string, summaryMarkdown: string, properties: ResolvedProperty[], includesTranscript: boolean, includesChatMessages: boolean} | {contextExceeded: true, requiredTokens: number, loadedContextLength?: number} | {stopped: true} | null>}
 */
export async function enrichWithLlm(meeting, settings, signal) {
    try {
        if (!settings || !settings.obsidianUseLlm) {
            return null
        }
        const endpoint = settings.obsidianLlmEndpoint
        if (!endpoint) {
            return null
        }
        const model = settings.obsidianLlmModel

        // A per-meeting override (set via the header toolbar's Follow-up picker) takes
        // priority over the automatic keyword match. A stale override — the referenced
        // template was since deleted — falls through to automatic resolution rather than
        // failing, matching this function's "never throw" contract.
        const templates = settings.obsidianLlmSummaryTemplates || []
        const overrideId = meeting.templateOverrideId
        const overridden = overrideId
            ? overrideId === "default"
                ? resolveDefaultTemplate(templates)
                : templates.find((t) => t.id === overrideId)
            : undefined
        const template = migrateLegacyTemplate(
            overridden || resolveTemplateForTitle(getMeetingTitle(meeting), templates) || resolveDefaultTemplate(templates),
        )
        const meetingVariables = getMeetingVariables(meeting)
        const instructions = [...collectInstructions(template).values()]

        /** @type {Map<string, unknown>} */
        let instructionAnswers = new Map()

        if (instructions.length > 0) {
            const userPrompt = buildInterpreterUserPrompt(meeting, instructions, settings.outputLanguage)
            const systemPrompt = settings.obsidianLlmSystemPrompt
            const fullPromptText = systemPrompt + "\n" + userPrompt

            if (model) {
                const { loadedContextLength, maxContextLength } = await getModelContextInfo(
                    endpoint,
                    model,
                    settings.obsidianLlmApiKey,
                    signal,
                )
                if (signal?.aborted) {
                    return { stopped: true }
                }
                // Prefer the model's currently loaded context (most accurate — what it's
                // actually running with right now); fall back to its max context when LM
                // Studio hasn't auto-loaded the model yet, so `loaded_context_length` isn't
                // reported at all — see getModelContextInfo()'s doc comment.
                const contextCeiling = loadedContextLength ?? maxContextLength
                if (contextCeiling !== null) {
                    const requiredTokens = estimateTokenCount(fullPromptText)
                    // Compare the *buffered* size (transcript/prompt + headroom for the
                    // model's own response — see suggestedContextWindow()'s doc comment),
                    // not the bare prompt estimate, so a transcript that just barely fits
                    // the prompt but leaves no room to actually generate a response still
                    // gets caught here instead of firing a request that comes back
                    // truncated or empty.
                    if (suggestedContextWindow(requiredTokens) > contextCeiling) {
                        return { contextExceeded: true, requiredTokens, loadedContextLength: contextCeiling }
                    }
                }
            }

            const timeoutMs = settings.obsidianLlmTimeoutMs || DEFAULT_LLM_TIMEOUT_MS

            const controller = new AbortController()
            const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)
            bridgeExternalAbort(controller, signal)

            /** @type {Response} */
            let response
            try {
                response = await fetch(endpoint, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(settings.obsidianLlmApiKey ? { Authorization: `Bearer ${settings.obsidianLlmApiKey}` } : {}),
                    },
                    body: JSON.stringify({
                        model,
                        temperature: 0.3,
                        stream: false,
                        messages: [
                            { role: "system", content: systemPrompt },
                            { role: "user", content: userPrompt },
                        ],
                    }),
                    signal: controller.signal,
                })
            } catch {
                // Server unreachable, DNS failure, missing host permission, this function's
                // own timeout firing, or the external `signal` being aborted — all surface
                // as a rejected fetch() here alike. Only the last of those is a user-
                // triggered Stop, distinguished below by checking the external signal
                // specifically (an internal timeout never touches it).
                return signal?.aborted ? { stopped: true } : null
            } finally {
                clearTimeout(timeoutHandle)
            }

            if (!response.ok) {
                // The pre-flight check above is best-effort and may have found no ceiling
                // to compare against at all (non-LM-Studio provider, a model id LM Studio's
                // own /api/v0/models doesn't recognize, that request timing out, etc.) — if
                // so, this is the fallback: the server itself just told us, authoritatively,
                // whether this specific rejection was a context/token-limit problem. Unlike
                // the pre-flight path, there's no reliable numeric ceiling to report here
                // (we only have the server's prose, not a guaranteed number in it), so
                // `loadedContextLength` is omitted rather than guessed at.
                if (await isContextLengthError(response)) {
                    return { contextExceeded: true, requiredTokens: estimateTokenCount(fullPromptText) }
                }
                return null
            }

            /** @type {any} */
            let body
            try {
                body = await response.json()
            } catch {
                return null
            }

            const content = body?.choices?.[0]?.message?.content
            if (typeof content !== "string" || content.trim() === "") {
                return null
            }

            const parsed = extractJsonFromResponse(content)
            if (parsed === null) {
                return null
            }

            instructionAnswers = buildInstructionAnswers(parsed, instructions)
        }

        const resolveCtx = { meetingVariables, instructionAnswers }
        const resolvedProperties = (template.properties || []).map((p) => ({
            name: p.name,
            type: p.type,
            value: resolvePropertyValue(p.value, resolveCtx, p.type),
        }))
        const summaryMarkdown = resolveValue(template.noteContent, resolveCtx).trim()

        if (!summaryMarkdown && resolvedProperties.length === 0) {
            // Nothing usable came out of this template at all — treat the same as a
            // failure so the caller falls back to the plain note.
            return null
        }

        const titleProperty = resolvedProperties.find((p) => p.name === "title")
        const title =
            titleProperty && typeof titleProperty.value === "string" ? asNonEmptyString(titleProperty.value) : undefined

        return {
            title,
            summaryMarkdown,
            properties: resolvedProperties,
            includesTranscript: templateReferencesVariable(template.noteContent, "transcript"),
            includesChatMessages: templateReferencesVariable(template.noteContent, "chatMessages"),
        }
    } catch {
        // Final safety net: no matter what goes wrong above (including a bug in this
        // file), enrichment must degrade to "skip it", never throw into the caller.
        return null
    }
}
