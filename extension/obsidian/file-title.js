// @ts-check

const MAX_TITLE_CHARS = 80

/**
 * An AI summary title made fit for a filename: one line, without quotes, a "Title:" label,
 * or a leading date (the filename template already adds one, and the default summary
 * template's title has one too).
 * @param {unknown} raw
 * @returns {string | undefined}
 */
export function cleanFileTitle(raw) {
    if (typeof raw !== "string") return undefined
    const line = raw.split("\n").map((part) => part.trim()).find(Boolean) || ""
    const title = line
        .replace(/^[#*\s]*title\s*:\s*/i, "")
        .replace(/^\d{4}-\d{2}-\d{2}[\s\-–—:]*/, "")
        .replace(/^["'“”*#\s]+|["'“”*.\s]+$/g, "")
    return [...title].slice(0, MAX_TITLE_CHARS).join("").trim() || undefined
}
