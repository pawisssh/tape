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
// The pure helpers below (extractJsonFromResponse, renderSummaryMarkdown) have no
// chrome.*/network dependency and are unit-tested directly in tests/llm.test.mjs.
// enrichWithLlm is the only function here that touches the network.

import { groupTranscriptBySpeaker, getMeetingTitle } from "./markdown.js"

/** @type {ObsidianLlmEndpoint} */
export const DEFAULT_LLM_ENDPOINT = "http://localhost:1234/v1/chat/completions"

// Documented in-UI/README alternative for Ollama's OpenAI-compatible endpoint:
// "http://localhost:11434/v1/chat/completions"

/** @type {ObsidianLlmModel} */
export const DEFAULT_LLM_MODEL = ""

/** @type {ObsidianLlmTimeoutMs} */
export const DEFAULT_LLM_TIMEOUT_MS = 90000

const SYSTEM_PROMPT = `You are an assistant that turns a raw video-call transcript into structured meeting notes.

Read the transcript the user provides and respond with EXACTLY ONE JSON object and nothing else: no prose before or after it, no markdown code fences, no <think> or other reasoning block, no explanation of what you are doing.

The JSON object must match this shape (all keys present; arrays may be empty; "owner" and "dueDate" are optional per action item):
{
  "title": "string, <=60 chars, must not contain / : # [ ] | ^",
  "summary": "string, 2-5 sentences, markdown allowed",
  "topics": [{"heading": "string", "points": ["string"]}],
  "actionItems": [{"task": "string", "owner": "string (optional)", "dueDate": "string (optional)"}],
  "decisions": ["string"],
  "openQuestions": ["string"],
  "nextSteps": ["string"]
}

Rules:
- Leave any array empty ([]) rather than invent content that is not clearly supported by the transcript.
- Never invent an "owner" or "dueDate" for an action item — only include them when a name or date is explicitly stated in the transcript for that specific task.
- Write "title", "summary", and every other string field in the same language the transcript itself is written in.
- Only populate "topics" when the meeting naturally splits into a few distinct themes or agenda items. For a short or single-topic meeting, leave "topics" as an empty array and rely on "summary" instead.
- Do not wrap the JSON in a code fence, and do not include any text — reasoning, apologies, or otherwise — before or after the JSON object.`

/**
 * @param {Meeting} meeting
 * @returns {string}
 */
function buildUserPrompt(meeting) {
    const title = getMeetingTitle(meeting)
    const software = meeting.meetingSoftware || "Meeting"
    const groups = groupTranscriptBySpeaker(meeting.transcript)

    const transcriptText = groups.length > 0
        ? groups.map((g) => `${g.personName}: ${g.text}`).join("\n")
        : "(no transcript captured)"

    const chatMessages = meeting.chatMessages || []
    const chatText = chatMessages.length > 0
        ? chatMessages.map((m) => `${m.personName}: ${m.chatMessageText}`).join("\n")
        : ""

    const lines = [
        `Meeting title: ${title}`,
        `Platform: ${software}`,
        "",
        "Transcript:",
        transcriptText,
    ]

    if (chatText) {
        lines.push("", "Chat messages:", chatText)
    }

    return lines.join("\n")
}

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
 * @param {unknown} value
 * @returns {any[]}
 */
function asArray(value) {
    return Array.isArray(value) ? value : []
}

/**
 * @param {unknown} points
 * @returns {string[]}
 */
function renderTopicPoints(points) {
    return asArray(points)
        .map((p) => asNonEmptyString(p))
        .filter((p) => typeof p === "string")
}

/**
 * Render the "## Key topics" section. A topic missing a heading, or whose points array
 * has no usable (non-empty-string) entries, is dropped entirely rather than rendered
 * with a blank heading or an empty bullet list.
 * @param {unknown} topics
 * @returns {string}
 */
function renderTopicsSection(topics) {
    const rendered = []
    for (const topic of asArray(topics)) {
        if (!topic || typeof topic !== "object") {
            continue
        }
        const heading = asNonEmptyString(/** @type {any} */ (topic).heading)
        const points = renderTopicPoints(/** @type {any} */ (topic).points)
        if (!heading || points.length === 0) {
            continue
        }
        rendered.push([`### ${heading}`, "", ...points.map((p) => `- ${p}`)].join("\n"))
    }
    return rendered.length > 0 ? ["## Key topics", "", rendered.join("\n\n")].join("\n") : ""
}

/**
 * Render the "## Action items" section as a checklist. "owner"/"dueDate" are only
 * appended when present — an action item with neither renders as a plain checklist line.
 * @param {unknown} actionItems
 * @returns {string}
 */
function renderActionItemsSection(actionItems) {
    const lines = []
    for (const item of asArray(actionItems)) {
        if (!item || typeof item !== "object") {
            continue
        }
        const task = asNonEmptyString(/** @type {any} */ (item).task)
        if (!task) {
            continue
        }
        const owner = asNonEmptyString(/** @type {any} */ (item).owner)
        const dueDate = asNonEmptyString(/** @type {any} */ (item).dueDate)
        const meta = []
        if (owner) meta.push(`Owner: ${owner}`)
        if (dueDate) meta.push(`Due: ${dueDate}`)
        const suffix = meta.length > 0 ? ` (${meta.join(", ")})` : ""
        lines.push(`- [ ] ${task}${suffix}`)
    }
    return lines.length > 0 ? ["## Action items", "", lines.join("\n")].join("\n") : ""
}

/**
 * Render a simple bullet-list section from an array of strings. Non-string / empty
 * entries are dropped; the whole section is omitted if nothing remains.
 * @param {string} heading e.g. "## Decisions"
 * @param {unknown} items
 * @returns {string}
 */
function renderBulletSection(heading, items) {
    const lines = asArray(items)
        .map((i) => asNonEmptyString(i))
        .filter((i) => typeof i === "string")
        .map((i) => `- ${i}`)
    return lines.length > 0 ? [heading, "", lines.join("\n")].join("\n") : ""
}

/**
 * Render each field of a parsed LLM response as an independent markdown section, in a
 * fixed order: Summary, Key topics, Action items, Decisions, Open questions, Next
 * steps. Any missing/malformed field is simply omitted rather than crashing — this
 * function never throws, so a response with only `summary` still produces a valid,
 * shorter markdown fragment. Returns "" if nothing at all was renderable.
 * @param {Object | null | undefined} parsed
 * @returns {string}
 */
export function renderSummaryMarkdown(parsed) {
    if (!parsed || typeof parsed !== "object") {
        return ""
    }
    const p = /** @type {any} */ (parsed)

    const sections = []

    const summary = asNonEmptyString(p.summary)
    if (summary) {
        sections.push(["## Summary", "", summary].join("\n"))
    }

    const topicsSection = renderTopicsSection(p.topics)
    if (topicsSection) sections.push(topicsSection)

    const actionItemsSection = renderActionItemsSection(p.actionItems)
    if (actionItemsSection) sections.push(actionItemsSection)

    const decisionsSection = renderBulletSection("## Decisions", p.decisions)
    if (decisionsSection) sections.push(decisionsSection)

    const openQuestionsSection = renderBulletSection("## Open questions", p.openQuestions)
    if (openQuestionsSection) sections.push(openQuestionsSection)

    const nextStepsSection = renderBulletSection("## Next steps", p.nextSteps)
    if (nextStepsSection) sections.push(nextStepsSection)

    return sections.join("\n\n")
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
 * Call the configured local LLM server and turn its response into markdown ready to be
 * injected into buildMarkdown() as the `summaryMarkdown` option (and optionally an
 * `overrideTitle`). This is the ONLY function in this file that touches the network —
 * every other export above is a pure helper.
 *
 * Non-negotiable: this function must never throw and must never reject. Every failure
 * mode (server unreachable, DNS failure, missing host permission, non-2xx response,
 * timeout/abort, an unparseable or empty response body, or any other unexpected error)
 * resolves to `null`. The caller (handoff.js) treats `null` as "skip enrichment, fall
 * back to the plain Phase-3 markdown" and never needs a try/catch of its own around
 * this call.
 * @param {Meeting} meeting
 * @param {ObsidianSettings} settings
 * @returns {Promise<{title?: string, summaryMarkdown: string} | null>}
 */
export async function enrichWithLlm(meeting, settings) {
    try {
        if (!settings || !settings.obsidianUseLlm) {
            return null
        }
        const endpoint = settings.obsidianLlmEndpoint || DEFAULT_LLM_ENDPOINT
        if (!endpoint) {
            return null
        }
        const timeoutMs = settings.obsidianLlmTimeoutMs || DEFAULT_LLM_TIMEOUT_MS

        const controller = new AbortController()
        const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)

        /** @type {Response} */
        let response
        try {
            response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: settings.obsidianLlmModel || DEFAULT_LLM_MODEL,
                    temperature: 0.3,
                    stream: false,
                    messages: [
                        { role: "system", content: SYSTEM_PROMPT },
                        { role: "user", content: buildUserPrompt(meeting) },
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

        const summaryMarkdown = renderSummaryMarkdown(parsed)
        if (!summaryMarkdown) {
            // Nothing usable came back (e.g. every field was empty/malformed) — treat
            // the same as a failure so the caller falls back to the plain note.
            return null
        }

        const title = asNonEmptyString(/** @type {any} */ (parsed).title)

        return { title, summaryMarkdown }
    } catch {
        // Final safety net: no matter what goes wrong above (including a bug in this
        // file), enrichment must degrade to "skip it", never throw into the caller.
        return null
    }
}
