// @ts-check
/// <reference path="../../types/index.js" />
/// <reference path="../../types/obsidian.js" />

// Pure functions only. No chrome.*, no network, no DOM — unit-testable with plain
// `node --test`. See PLAN.md Phase 3 / §8 for the correctness requirements this file
// is held to.

/** @type {ObsidianFileNameTemplate} */
export const DEFAULT_FILENAME_TEMPLATE = "{{date}} - {{title}}"

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
 * Build the destination filename (including the .md extension) from a template.
 * Each token's *value* is sanitized individually before substitution (so a "/" or ":"
 * inside a meeting title never becomes a path separator or otherwise corrupts the
 * template's intended structure), and the fully-substituted result is sanitized again
 * defensively (covers illegal characters that were literally present in a user-authored
 * template, and re-validates the reserved-name/leading-trailing-dot rules against the
 * final combined string). Truncates to a conservative max length, preserving the
 * extension.
 * @param {ObsidianFileNameTemplate | undefined | null} template
 * @param {Meeting} meeting
 * @returns {string}
 */
export function buildFilename(template, meeting) {
    const effectiveTemplate = template || DEFAULT_FILENAME_TEMPLATE

    const tokenValues = {
        "{{date}}": sanitizeFilenameComponent(formatDateToken(meeting.meetingStartTimestamp)),
        "{{time}}": sanitizeFilenameComponent(formatTimeToken(meeting.meetingStartTimestamp)),
        "{{title}}": sanitizeFilenameComponent(getMeetingTitle(meeting)),
        "{{software}}": sanitizeFilenameComponent(meeting.meetingSoftware || "Meeting"),
    }

    let result = effectiveTemplate
    for (const [token, value] of Object.entries(tokenValues)) {
        result = result.split(token).join(value)
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
 * @param {Meeting} meeting
 * @param {MarkdownBuildOptions} [options]
 * @returns {string}
 */
export function buildFrontmatter(meeting, options) {
    const title = (options && options.overrideTitle) || getMeetingTitle(meeting)
    const date = formatDateToken(meeting.meetingStartTimestamp)
    const duration = formatDuration(meeting.meetingStartTimestamp, meeting.meetingEndTimestamp)
    const software = meeting.meetingSoftware || ""
    const participants = getParticipants(meeting.transcript, meeting.chatMessages)

    const lines = ["---"]
    lines.push(`title: ${toYamlString(title)}`)
    lines.push(`date: ${toYamlString(date)}`)
    lines.push(`start: ${toYamlString(meeting.meetingStartTimestamp)}`)
    lines.push(`end: ${toYamlString(meeting.meetingEndTimestamp)}`)
    lines.push(`duration: ${toYamlString(duration)}`)
    lines.push(`software: ${toYamlString(software)}`)
    if (participants.length > 0) {
        lines.push("participants:")
        for (const name of participants) {
            lines.push(`  - ${toYamlString(name)}`)
        }
    } else {
        lines.push("participants: []")
    }
    lines.push("---")

    return lines.join("\n")
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
 * @param {Transcript} transcript
 * @returns {string}
 */
export function renderTranscriptSection(transcript) {
    const groups = groupTranscriptBySpeaker(transcript)
    if (groups.length === 0) {
        return "## Transcript\n\n_No transcript captured for this meeting._"
    }
    const lines = ["## Transcript", ""]
    for (const group of groups) {
        lines.push(`**${group.personName}** (${formatDisplayTime(group.timestamp)})`)
        lines.push(group.text)
        lines.push("")
    }
    return lines.join("\n").trimEnd()
}

/**
 * @param {ChatMessages} chatMessages
 * @returns {string}
 */
export function renderChatSection(chatMessages) {
    if (!chatMessages || chatMessages.length === 0) {
        return ""
    }
    const lines = ["## Chat messages", ""]
    for (const message of chatMessages) {
        lines.push(`**${message.personName}** (${formatDisplayTime(message.timestamp)})`)
        lines.push(message.chatMessageText)
        lines.push("")
    }
    return lines.join("\n").trimEnd()
}

/**
 * Build the full Markdown note body for a meeting: frontmatter, an H1 title, the
 * transcript section, and (if non-empty) a chat messages section.
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

    sections.push(renderTranscriptSection(meeting.transcript))

    const chatSection = renderChatSection(meeting.chatMessages)
    if (chatSection) {
        sections.push("", chatSection)
    }

    return sections.join("\n").trimEnd() + "\n"
}
