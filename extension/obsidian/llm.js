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
export const DEFAULT_LLM_TIMEOUT_MS = 300000

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
 * Best-effort read of the context window `model` is CURRENTLY loaded with, via LM
 * Studio's native `GET {origin}/api/v0/models/{model}` endpoint (`loaded_context_length`
 * field — present only while the model is actually loaded; distinct from the model's
 * `max_context_length`, which is just its training-time ceiling and says nothing about
 * how it's currently configured). This is an LM-Studio-specific extension, not part of
 * the OpenAI spec the rest of this file targets — on Ollama or any other server, or if
 * anything about this request goes wrong (unreachable, timeout, non-2xx, unparseable body,
 * or the field simply isn't present), this resolves to `null`, meaning "unknown — the
 * caller should skip the context-size check, not treat this as an error."
 * @param {string} endpoint the configured chat-completions endpoint
 * @param {string} model
 * @param {string} [apiKey]
 * @returns {Promise<number | null>}
 */
async function getLoadedContextLength(endpoint, model, apiKey) {
    /** @type {string} */
    let origin
    try {
        origin = new URL(endpoint).origin
    } catch {
        return null
    }

    const controller = new AbortController()
    const timeoutHandle = setTimeout(() => controller.abort(), MODEL_INFO_TIMEOUT_MS)
    try {
        const response = await fetch(`${origin}/api/v0/models/${encodeURIComponent(model)}`, {
            headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
            signal: controller.signal,
        })
        if (!response.ok) {
            return null
        }
        /** @type {any} */
        const body = await response.json()
        const loadedContextLength = body?.loaded_context_length
        return typeof loadedContextLength === "number" && Number.isFinite(loadedContextLength)
            ? loadedContextLength
            : null
    } catch {
        return null
    } finally {
        clearTimeout(timeoutHandle)
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
 * The one exception: if LM Studio reports the model is currently loaded with less context
 * than this transcript is estimated to need, this resolves to a distinct
 * `{contextExceeded: true, requiredTokens, loadedContextLength}` shape instead — a
 * deliberately actionable, user-fixable condition (reload the model in LM Studio with more
 * context) that the caller surfaces as a blocking, retryable error rather than silently
 * dropping the summary. This check is itself best-effort: if the loaded context length
 * can't be determined (non-LM-Studio server, model info unavailable, etc.), it's simply
 * skipped and the normal request proceeds.
 * @param {Meeting} meeting
 * @param {ObsidianSettings} settings
 * @returns {Promise<{title?: string, summaryMarkdown: string, properties: ResolvedProperty[], includesTranscript: boolean, includesChatMessages: boolean} | {contextExceeded: true, requiredTokens: number, loadedContextLength: number} | null>}
 */
export async function enrichWithLlm(meeting, settings) {
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
            const userPrompt = buildInterpreterUserPrompt(meeting, instructions)
            const systemPrompt = settings.obsidianLlmSystemPrompt
            const fullPromptText = systemPrompt + "\n" + userPrompt

            if (model) {
                const loadedContextLength = await getLoadedContextLength(endpoint, model, settings.obsidianLlmApiKey)
                if (loadedContextLength !== null) {
                    const requiredTokens = estimateTokenCount(fullPromptText)
                    if (requiredTokens > loadedContextLength) {
                        return { contextExceeded: true, requiredTokens, loadedContextLength }
                    }
                }
            }

            const timeoutMs = settings.obsidianLlmTimeoutMs || DEFAULT_LLM_TIMEOUT_MS

            const controller = new AbortController()
            const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)

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
                // Server unreachable, DNS failure, missing host permission, or the abort
                // firing (timeout) — all surface as a rejected fetch() here.
                return null
            } finally {
                clearTimeout(timeoutHandle)
            }

            if (!response.ok) {
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
