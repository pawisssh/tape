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

import { groupTranscriptBySpeaker, getMeetingTitle, formatElapsedTime } from "./markdown.js"

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

Each transcript line is prefixed with an elapsed-time marker — "[M:SS]" for meetings under an hour, "[H:MM:SS]" for meetings an hour or longer — showing how far into the meeting that line was spoken. Whenever you fill in a "timestamp" field below, copy that bracket's value EXACTLY as it appears on the transcript line it came from. Never invent, estimate, or round a timestamp. If you cannot confidently attribute an item to one specific transcript line, omit the "timestamp" field entirely rather than guess.

The JSON object must match this shape (all keys present; arrays may be empty; every "timestamp" field is optional):
{
  "title": "string, <=60 chars, must not contain / : # [ ] | ^",
  "actionItems": [{"task": "string", "timestamp": "string (optional)"}],
  "decisions": [{"text": "string", "timestamp": "string (optional)"}],
  "openQuestions": [{"text": "string", "timestamp": "string (optional)"}],
  "nextSteps": [{"text": "string", "timestamp": "string (optional)"}],
  "keyTakeaways": [{"lead": "string", "detail": "string"}],
  "topics": [{"heading": "string", "points": [{"text": "string", "timestamp": "string (optional)"}]}]
}

Field notes:
- "actionItems" are concrete follow-up tasks, phrased as the task itself. Do not include an owner or a due date anywhere — this schema has no field for either.
- "decisions" are choices the group explicitly settled on.
- "openQuestions" are things left unresolved at the end of the meeting.
- "nextSteps" are what happens after the meeting as a whole (the overall plan or sequence going forward), distinct from "actionItems" (individual tasks).
- "keyTakeaways" is a short bulleted TL;DR of the meeting: each item is a short bold "lead" phrase followed by one sentence of "detail". This replaces a prose summary — never write a paragraph-style summary anywhere in your response. "keyTakeaways" items are synthesized across the whole meeting, so never include a "timestamp" for them.
- "topics" groups the discussion into a few natural themes, each with its own list of timestamped "points".

Rules:
- Leave any array empty ([]) rather than invent content that is not clearly supported by the transcript.
- Write "title" and every other string field in the same language the transcript itself is written in.
- Only populate "topics" when the meeting naturally splits into a few distinct themes or agenda items. For a short or single-topic meeting, leave "topics" as an empty array.
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
        ? groups.map((g) => {
            const elapsed = formatElapsedTime(meeting.meetingStartTimestamp, g.timestamp)
            return elapsed ? `[${elapsed}] ${g.personName}: ${g.text}` : `${g.personName}: ${g.text}`
        }).join("\n")
        : "(no transcript captured)"

    const chatMessages = meeting.chatMessages || []
    const chatText = chatMessages.length > 0
        ? chatMessages.map((m) => `${m.personName}: ${m.chatMessageText}`).join("\n")
        : ""

    const lines = [
        `Meeting title: ${title}`,
        `Platform: ${software}`,
        "",
        "Each transcript line below is prefixed with [M:SS] or [H:MM:SS], the elapsed time from the start of the meeting.",
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

// Light validator for a "timestamp" field coming back from the model: matches
// "M:SS"/"H:MM:SS" (1-3 digit hour/minute component, 2-digit seconds/minutes each
// 00-59), rejects garbage like "unknown" or "12:65". This is the single chokepoint
// every renderer below goes through to decide whether to print a "[...]" suffix —
// "drop the bracket, keep the text" is enforced here once rather than re-implemented
// per section.
const TIMESTAMP_REGEX = /^\d{1,3}:[0-5]\d(:[0-5]\d)?$/

/**
 * @param {unknown} timestamp
 * @returns {string} " [M:SS]"/" [H:MM:SS]" if valid, else ""
 */
function formatTimestampSuffix(timestamp) {
    return typeof timestamp === "string" && TIMESTAMP_REGEX.test(timestamp) ? ` [${timestamp}]` : ""
}

/**
 * Render one `- text [timestamp]` bullet from an item shaped like `{[textKey]: string,
 * timestamp?: string}`. Drops the item (returns `null`) if its text field is
 * empty/non-string; the timestamp suffix is omitted (not the whole bullet) if the
 * timestamp is missing or fails validation.
 * @param {unknown} item
 * @param {string} textKey
 * @returns {string | null}
 */
function renderTimestampedBullet(item, textKey) {
    if (!item || typeof item !== "object") {
        return null
    }
    const text = asNonEmptyString(/** @type {any} */ (item)[textKey])
    if (!text) {
        return null
    }
    return `- ${text}${formatTimestampSuffix(/** @type {any} */ (item).timestamp)}`
}

/**
 * Render a section of timestamped bullets (decisions/openQuestions/nextSteps all share
 * this shape: `{text, timestamp?}`). Non-object / missing-text entries are dropped; the
 * whole section is omitted if nothing remains.
 * @param {string} heading e.g. "## Decisions made"
 * @param {unknown} items
 * @returns {string}
 */
function renderTimestampedListSection(heading, items) {
    const lines = asArray(items)
        .map((item) => renderTimestampedBullet(item, "text"))
        .filter((line) => typeof line === "string")
    return lines.length > 0 ? [heading, "", lines.join("\n")].join("\n") : ""
}

/**
 * Render the "## Action items" section as a checklist: `- [ ] task [M:SS]`. No
 * owner/due-date handling at all — that metadata was removed from the schema entirely.
 * @param {unknown} actionItems
 * @returns {string}
 */
function renderActionItemsSection(actionItems) {
    const lines = asArray(actionItems)
        .map((item) => {
            if (!item || typeof item !== "object") {
                return null
            }
            const task = asNonEmptyString(/** @type {any} */ (item).task)
            if (!task) {
                return null
            }
            return `- [ ] ${task}${formatTimestampSuffix(/** @type {any} */ (item).timestamp)}`
        })
        .filter((line) => typeof line === "string")
    return lines.length > 0 ? ["## Action items", "", lines.join("\n")].join("\n") : ""
}

/**
 * Render the "## Key Takeaways" section: a bold-lead-in TL;DR list, `- **Lead:**
 * Detail.`. An item is dropped unless BOTH `lead` and `detail` are non-empty strings.
 * Stray trailing punctuation/whitespace is trimmed off `lead` before formatting so it
 * never produces a doubled colon (e.g. a model-supplied "Lead:" would otherwise render
 * as "**Lead::**"). Never given a timestamp suffix — these items are synthesized across
 * the whole meeting, not tied to one transcript moment.
 * @param {unknown} keyTakeaways
 * @returns {string}
 */
function renderKeyTakeawaysSection(keyTakeaways) {
    const lines = asArray(keyTakeaways)
        .map((item) => {
            if (!item || typeof item !== "object") {
                return null
            }
            const lead = asNonEmptyString(/** @type {any} */ (item).lead)
            const detail = asNonEmptyString(/** @type {any} */ (item).detail)
            if (!lead || !detail) {
                return null
            }
            const cleanLead = lead.replace(/[\s.:]+$/u, "")
            return `- **${cleanLead}:** ${detail}`
        })
        .filter((line) => typeof line === "string")
    return lines.length > 0 ? ["## Key Takeaways", "", lines.join("\n")].join("\n") : ""
}

/**
 * Render the "## Topics" section. A topic missing a heading, or whose points array has
 * no usable entries (each point needs a non-empty "text"), is dropped entirely rather
 * than rendered with a blank heading or an empty bullet list. Points are rendered via
 * the shared timestamped-bullet helper.
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
        const points = asArray(/** @type {any} */ (topic).points)
            .map((point) => renderTimestampedBullet(point, "text"))
            .filter((line) => typeof line === "string")
        if (!heading || points.length === 0) {
            continue
        }
        rendered.push([`### ${heading}`, "", points.join("\n")].join("\n"))
    }
    return rendered.length > 0 ? ["## Topics", "", rendered.join("\n\n")].join("\n") : ""
}

/**
 * Render each field of a parsed LLM response as an independent markdown section, in a
 * fixed order: Action items, Decisions made, Open questions, Next steps, Key
 * Takeaways, Topics. There is no "Summary" section — it was removed from the schema
 * entirely in favor of "Key Takeaways". Any missing/malformed field is simply omitted
 * rather than crashing — this function never throws, so a response with only one
 * populated field still produces a valid, shorter markdown fragment. Returns "" if
 * nothing at all was renderable.
 * @param {Object | null | undefined} parsed
 * @returns {string}
 */
export function renderSummaryMarkdown(parsed) {
    if (!parsed || typeof parsed !== "object") {
        return ""
    }
    const p = /** @type {any} */ (parsed)

    const sections = []

    const actionItemsSection = renderActionItemsSection(p.actionItems)
    if (actionItemsSection) sections.push(actionItemsSection)

    const decisionsSection = renderTimestampedListSection("## Decisions made", p.decisions)
    if (decisionsSection) sections.push(decisionsSection)

    const openQuestionsSection = renderTimestampedListSection("## Open questions", p.openQuestions)
    if (openQuestionsSection) sections.push(openQuestionsSection)

    const nextStepsSection = renderTimestampedListSection("## Next steps", p.nextSteps)
    if (nextStepsSection) sections.push(nextStepsSection)

    const keyTakeawaysSection = renderKeyTakeawaysSection(p.keyTakeaways)
    if (keyTakeawaysSection) sections.push(keyTakeawaysSection)

    const topicsSection = renderTopicsSection(p.topics)
    if (topicsSection) sections.push(topicsSection)

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
