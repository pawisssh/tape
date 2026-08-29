// @ts-check
/// <reference path="../../types/index.js" />
/// <reference path="../../types/obsidian.js" />

// Pure functions only. No chrome.*, no network, no DOM — unit-testable with plain
// `node --test`. See PLAN.md Phase 3 / §8 for the correctness requirements this file
// is held to.

import { parseTemplateSegments, applyFilters } from "./template-syntax.js"

/** @type {ObsidianFileNameTemplate} */
export const DEFAULT_FILENAME_TEMPLATE = '{{date}}-{{"a concise, engaging title for this meeting"|kebab}}-meeting-note'

// Conservative safety margin for a filename component (not a full path). Most
// filesystems in practical use (APFS, ext4, NTFS) allow up to 255 bytes per path
// component; we cap well under that to leave headroom for multi-byte UTF-8 characters
// (an emoji or CJK character can be 3-4 bytes) and for Obsidian/OS-level path-length
// limits further up the chain that this module has no visibility into. Judgment call —
// no authoritative single number exists; flagged for tech-lead review per task instructions.
const MAX_FILENAME_LENGTH = 200
const FILE_EXTENSION = ".md"

// Adapted from upstream's `invalidFilenameRegex` (extension/background-script/exporters.js)
// so filename sanitization stays consistent between the .txt export path and the new
// Obsidian .md export path. Strips characters illegal in Windows/macOS/Linux filenames,
// leading/trailing dots and whitespace-like separators (including Unicode line/paragraph/
// space separators and the NUL char), and Windows reserved device names
// (CON/PRN/AUX/NUL/COM1-9/LPT1-9), case-insensitively. https://stackoverflow.com/a/78675894
const INVALID_FILENAME_REGEX = /[:?"*<>|~/\\\u{1}-\u{1f}\u{7f}\u{80}-\u{9f}\p{Cf}\p{Cn}]|^[.\u{0}\p{Zl}\p{Zp}\p{Zs}]|[.\u{0}\p{Zl}\p{Zp}\p{Zs}]$|^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?=\.|$)/giu

/**
 * Sanitize a single filename component (a whole filename, OR a single token's value
 * before it gets substituted into a template — see buildFilename). Deliberately does
 * NOT allow "/" through, so a "/" embedded in a meeting title can never turn into a
 * path separator.
 * @param {string | undefined | null} value
 * @returns {string}
 */
export function sanitizeFilenameComponent(value) {
    if (!value) {
        return ""
    }
    return String(value).replace(INVALID_FILENAME_REGEX, "_")
}

/**
 * @param {Meeting} meeting
 * @returns {string}
 */
export function getMeetingTitle(meeting) {
    return meeting.meetingTitle || meeting.title || "Meeting"
}

/**
 * @param {string} isoTimestamp
 */
function formatDateToken(isoTimestamp) {
    const d = new Date(isoTimestamp)
    if (isNaN(d.getTime())) {
        return "unknown-date"
    }
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, "0")
    const dd = String(d.getDate()).padStart(2, "0")
    return `${yyyy}-${mm}-${dd}`
}

/**
 * @param {string} isoTimestamp
 */
function formatTimeToken(isoTimestamp) {
    const d = new Date(isoTimestamp)
    if (isNaN(d.getTime())) {
        return "unknown-time"
    }
    const hh = String(d.getHours()).padStart(2, "0")
    const min = String(d.getMinutes()).padStart(2, "0")
    // Colon is illegal in filenames on Windows, so use a hyphen instead of ":".
    return `${hh}-${min}`
}

/**
 * Human-readable duration string, e.g. "45m" or "1h 5m".
 * @param {string} startIso
 * @param {string} endIso
 */
export function formatDuration(startIso, endIso) {
    const start = new Date(startIso).getTime()
    const end = new Date(endIso).getTime()
    if (isNaN(start) || isNaN(end) || end < start) {
        return "unknown"
    }
    const totalMinutes = Math.round((end - start) / (1000 * 60))
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

/**
 * Elapsed time from meeting start to an event, formatted for citation in LLM-generated
 * summary bullets: "M:SS" for elapsed times under an hour, "H:MM:SS" at or above one
 * hour (e.g. "0:50", "41:12", "1:23:45"). Negative elapsed (event timestamp before
 * meeting start — clock skew right at call start) clamps to "0:00" rather than being
 * dropped. Unparseable input returns `null` (not a string sentinel) so the caller can
 * decide whether to print a bracket at all.
 * @param {string} startIso
 * @param {string} eventIso
 * @returns {string | null}
 */
export function formatElapsedTime(startIso, eventIso) {
    const start = new Date(startIso).getTime()
    const event = new Date(eventIso).getTime()
    if (isNaN(start) || isNaN(event)) {
        return null
    }
    let totalSeconds = Math.round((event - start) / 1000)
    if (totalSeconds < 0) {
        totalSeconds = 0
    }
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    const ss = String(seconds).padStart(2, "0")
    if (hours > 0) {
        const mm = String(minutes).padStart(2, "0")
        return `${hours}:${mm}:${ss}`
    }
    return `${minutes}:${ss}`
}

/**
 * Build the destination filename (including the .md extension) from a template.
 * Each token's *resolved* value is sanitized individually before substitution (so a "/"
 * or ":" inside a meeting title never becomes a path separator or otherwise corrupts the
 * template's intended structure), and the fully-substituted result is sanitized again
 * defensively (covers illegal characters that were literally present in a user-authored
 * template, and re-validates the reserved-name/leading-trailing-dot rules against the
 * final combined string). Truncates to a conservative max length, preserving the
 * extension.
 *
 * Tokenized via template-syntax.js's parseTemplateSegments()/applyFilters() — the same
 * {{...}}/filter engine extension/obsidian/interpreter.js uses for Properties/Note
 * content — so a filter like `|kebab` works here too. Bare variables resolve from this
 * function's own small local map: `{{date}}`/`{{time}}` are the MEETING's own date/time
 * (deliberately NOT interpreter.js's `{{date}}`, which means "today" — that's a
 * different, unrelated variable table), `{{title}}` the meeting's raw title, `{{platform}}`
 * the meeting software. A quoted `{{"..."}}` token (any text) resolves to `options.aiTitle`
 * when provided and non-empty (the title already produced by the meeting's LLM summary,
 * see extension/obsidian/llm.js's enrichWithLlm), falling back to the meeting's own title
 * otherwise — so a filename never blocks on LLM/network availability — with that
 * segment's own filters (e.g. `|kebab`) still applied to whichever value it resolved to.
 * @param {ObsidianFileNameTemplate | undefined | null} template
 * @param {Meeting} meeting
 * @param {{aiTitle?: string}} [options]
 * @returns {string}
 */
export function buildFilename(template, meeting, options) {
    const effectiveTemplate = template || DEFAULT_FILENAME_TEMPLATE

    /** @type {Record<string, string>} */
    const localVariables = {
        date: formatDateToken(meeting.meetingStartTimestamp),
        time: formatTimeToken(meeting.meetingStartTimestamp),
        title: getMeetingTitle(meeting),
        platform: meeting.meetingSoftware || "Meeting",
    }

    let result = ""
    for (const seg of parseTemplateSegments(effectiveTemplate)) {
        if (seg.kind === "literal") {
            result += seg.text
            continue
        }
        const rawValue =
            seg.kind === "variable"
                ? Object.prototype.hasOwnProperty.call(localVariables, seg.name)
                    ? localVariables[seg.name]
                    : ""
                : (options && options.aiTitle) || getMeetingTitle(meeting)
        result += sanitizeFilenameComponent(applyFilters(rawValue, seg.filters))
    }

    result = sanitizeFilenameComponent(result)
    if (!result) {
        result = "Meeting"
    }

    const maxBaseLength = MAX_FILENAME_LENGTH - FILE_EXTENSION.length
    if (result.length > maxBaseLength) {
        result = result.slice(0, maxBaseLength)
        // Truncation can leave a new trailing dot/space that was legal mid-string but
        // becomes illegal once it's the last character — strip it.
        result = result.replace(/[.\s]+$/u, "")
        if (!result) {
            result = "Meeting"
        }
    }

    return `${result}${FILE_EXTENSION}`
}

/**
 * Escape a string for safe use as a double-quoted YAML scalar in frontmatter. Prevents
 * YAML injection (a meeting title like `foo\ninjected: true` or one containing `: ` or
 * starting with `---` must never be interpreted as new YAML structure) by always
 * wrapping the value in double quotes and escaping backslashes/quotes, and by
 * collapsing embedded newlines to spaces since frontmatter fields here are single-line.
 * @param {string | undefined | null} value
 * @returns {string}
 */
export function toYamlString(value) {
    const str = value === undefined || value === null ? "" : String(value)
    const escaped = str
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\r\n|\r|\n/g, " ")
        // Strip other C0/DEL control characters that have no place in a single-line scalar (Unicode “Cc” category).
        .replace(/\p{Cc}/gu, "")
    return `"${escaped}"`
}

/**
 * @param {Transcript} transcript
 * @param {ChatMessages} chatMessages
 * @returns {string[]} unique participant names, in first-seen order
 */
export function getParticipants(transcript, chatMessages) {
    /** @type {string[]} */
    const seen = []
    for (const block of transcript || []) {
        if (block.personName && !seen.includes(block.personName)) {
            seen.push(block.personName)
        }
    }
    for (const message of chatMessages || []) {
        if (message.personName && !seen.includes(message.personName)) {
            seen.push(message.personName)
        }
    }
    return seen
}

/**
 * @typedef {{name: string, value: string | string[], type: TemplatePropertyType}} FrontmatterField
 */

/**
 * Render one frontmatter field as one or more YAML lines, per its type: text/date/
 * number/checkbox render as a single scalar line (non-string/array values are coerced —
 * joined with ", " if an array slipped in, e.g. a mistyped property type — never
 * throws); multitext renders as a YAML sequence (`name: []` inline for an empty array,
 * matching the original hardcoded `participants: []` behavior exactly).
 * @param {FrontmatterField} field
 * @returns {string[]}
 */
export function renderFrontmatterField(field) {
    const toScalarString = (value) => {
        if (Array.isArray(value)) return value.join(", ")
        if (value === undefined || value === null) return ""
        return String(value)
    }

    if (field.type === "multitext") {
        const items = Array.isArray(field.value) ? field.value : toScalarString(field.value).split(",").map((s) => s.trim()).filter(Boolean)
        if (items.length === 0) {
            return [`${field.name}: []`]
        }
        return [`${field.name}:`, ...items.map((item) => `  - ${toYamlString(item)}`)]
    }

    return [`${field.name}: ${toYamlString(toScalarString(field.value))}`]
}

/**
 * Overlay `overlay` fields on top of `baseline` by `name` — an overlay entry replaces a
 * baseline entry with the same name in place (preserving the baseline's field order),
 * and any overlay name not already in the baseline is appended in overlay order.
 * @param {FrontmatterField[]} baseline
 * @param {FrontmatterField[]} overlay
 * @returns {FrontmatterField[]}
 */
export function mergeFrontmatterFields(baseline, overlay) {
    const overlayByName = new Map((overlay || []).map((f) => [f.name, f]))
    const merged = baseline.map((f) => overlayByName.get(f.name) || f)
    const baselineNames = new Set(baseline.map((f) => f.name))
    for (const f of overlay || []) {
        if (!baselineNames.has(f.name)) {
            merged.push(f)
        }
    }
    return merged
}

/**
 * @param {Meeting} meeting
 * @param {MarkdownBuildOptions} [options]
 * @returns {string}
 */
export function buildFrontmatter(meeting, options) {
    const title = (options && options.overrideTitle) || getMeetingTitle(meeting)
    const date = formatDateToken(meeting.meetingStartTimestamp)
    const duration = formatDuration(meeting.meetingStartTimestamp, meeting.meetingEndTimestamp)
    const platform = meeting.meetingSoftware || ""
    const participants = getParticipants(meeting.transcript, meeting.chatMessages)

    /** @type {FrontmatterField[]} */
    const baseline = [
        { name: "title", type: "text", value: title },
        { name: "date", type: "date", value: date },
        { name: "start", type: "date", value: meeting.meetingStartTimestamp },
        { name: "end", type: "date", value: meeting.meetingEndTimestamp },
        { name: "duration", type: "text", value: duration },
        { name: "platform", type: "text", value: platform },
        { name: "participants", type: "multitext", value: participants },
    ]

    const merged = mergeFrontmatterFields(baseline, (options && options.resolvedProperties) || [])

    return ["---", ...merged.flatMap(renderFrontmatterField), "---"].join("\n")
}

/**
 * Group a flat transcript array into consecutive-same-speaker turns, merging their text.
 * @param {Transcript} transcript
 * @returns {{personName: string, timestamp: string, text: string}[]}
 */
export function groupTranscriptBySpeaker(transcript) {
    /** @type {{personName: string, timestamp: string, text: string}[]} */
    const groups = []
    for (const block of transcript || []) {
        const last = groups[groups.length - 1]
        if (last && last.personName === block.personName) {
            last.text += `\n${block.transcriptText}`
        } else {
            groups.push({
                personName: block.personName,
                timestamp: block.timestamp,
                text: block.transcriptText,
            })
        }
    }
    return groups
}

/**
 * @param {string} isoTimestamp
 */
function formatDisplayTime(isoTimestamp) {
    const d = new Date(isoTimestamp)
    if (isNaN(d.getTime())) {
        return ""
    }
    return d.toLocaleString("default", { hour: "2-digit", minute: "2-digit", hour12: true })
}

/**
 * The transcript's body text — speaker-grouped turns, no heading of its own. Used both
 * by renderTranscriptSection() below (which prepends the "## Transcript" heading) and
 * as interpreter.js's {{transcript}} variable (where the template supplies its own
 * heading, so no heading belongs here).
 * @param {Transcript} transcript
 * @returns {string}
 */
export function renderTranscriptBody(transcript) {
    const groups = groupTranscriptBySpeaker(transcript)
    if (groups.length === 0) {
        return "_No transcript captured for this meeting._"
    }
    const lines = []
    for (const group of groups) {
        lines.push(`**${group.personName}** (${formatDisplayTime(group.timestamp)})`)
        lines.push(group.text)
        lines.push("")
    }
    return lines.join("\n").trimEnd()
}

/**
 * @param {Transcript} transcript
 * @returns {string}
 */
export function renderTranscriptSection(transcript) {
    return `## Transcript\n\n${renderTranscriptBody(transcript)}`
}

/**
 * The chat messages' body text — no heading of its own (see renderTranscriptBody's doc
 * comment for why). Empty string if there are no chat messages at all (same as
 * renderChatSection — a template that references {{chatMessages}} unconditionally will
 * still get a blank result for a meeting with none, same as any other variable).
 * @param {ChatMessages} chatMessages
 * @returns {string}
 */
export function renderChatBody(chatMessages) {
    if (!chatMessages || chatMessages.length === 0) {
        return ""
    }
    const lines = []
    for (const message of chatMessages) {
        lines.push(`**${message.personName}** (${formatDisplayTime(message.timestamp)})`)
        lines.push(message.chatMessageText)
        lines.push("")
    }
    return lines.join("\n").trimEnd()
}

/**
 * @param {ChatMessages} chatMessages
 * @returns {string}
 */
export function renderChatSection(chatMessages) {
    const body = renderChatBody(chatMessages)
    return body ? `## Chat messages\n\n${body}` : ""
}

/**
 * The user's freeform per-meeting notes (Notes tab), rendered as the note's last
 * section — no AI involvement, just the user's own text trimmed and given a heading.
 * Empty/whitespace-only input renders nothing, same as an empty chat section.
 * @param {string | undefined | null} userNotes
 * @returns {string}
 */
export function renderNotesSection(userNotes) {
    const trimmed = (userNotes || "").trim()
    return trimmed ? `## Notes\n\n${trimmed}` : ""
}

/**
 * Build the full Markdown note body for a meeting: frontmatter, an H1 title, the
 * summary (if any), and — unless the resolved summary/noteContent already included them
 * itself (see options.suppressTranscriptSection/suppressChatSection, and
 * interpreter.js's {{transcript}}/{{chatMessages}} variables) — the transcript section
 * and (if non-empty) a chat messages section, appended as a safety net so a plain note
 * (no template, or a template that doesn't reference the transcript) never loses it.
 * Finally, the user's own Notes-tab content (if any) is appended last.
 * @param {Meeting} meeting
 * @param {MarkdownBuildOptions} [options]
 * @returns {string}
 */
export function buildMarkdown(meeting, options) {
    const title = (options && options.overrideTitle) || getMeetingTitle(meeting)
    const sections = [buildFrontmatter(meeting, options), "", `# ${title}`, ""]

    if (options && options.summaryMarkdown) {
        sections.push(options.summaryMarkdown, "")
    }

    if (!options || !options.suppressTranscriptSection) {
        sections.push(renderTranscriptSection(meeting.transcript))
    }

    if (!options || !options.suppressChatSection) {
        const chatSection = renderChatSection(meeting.chatMessages)
        if (chatSection) {
            sections.push("", chatSection)
        }
    }

    if (!options || !options.suppressNotesSection) {
        const notesSection = renderNotesSection(meeting.userNotes)
        if (notesSection) {
            sections.push("", notesSection)
        }
    }

    return sections.join("\n").trimEnd() + "\n"
}
