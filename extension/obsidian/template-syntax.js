// @ts-check

// Obsidian Web Clipper "Interpreter"-style template tokenizer + filter pipeline. Pure,
// zero-dependency (deliberately does NOT import from markdown.js or interpreter.js, so
// both of those can import from here without a circular-import cycle — markdown.js's
// buildFilename() needs the same {{...}}/filter parsing this module provides, and
// interpreter.js needs markdown.js's transcript/participant helpers, so this module is
// the shared base both sit on top of).
//
// A template string may contain {{...}} tokens:
//   - {{variableName}}                 a bare variable, resolved by the caller.
//   - {{"instruction text"}}           a quoted instruction, resolved by the caller.
//   - either form may be followed by one or more |filter or |filter:"args" calls,
//     applied left-to-right to the resolved value via applyFilters() below.
//
// Never throws anywhere in this file — an unparseable token, unknown filter, or
// malformed filter args all degrade gracefully (empty string/no-op) rather than
// erroring.

// ---------------------------------------------------------------------------
// Token parsing
// ---------------------------------------------------------------------------

/** @typedef {{name: string, argsRaw: string}} FilterCall */
/** @typedef {{kind: "literal", text: string}} LiteralSegment */
/** @typedef {{kind: "variable", name: string, filters: FilterCall[]}} VariableSegment */
/** @typedef {{kind: "instruction", instruction: string, filters: FilterCall[]}} InstructionSegment */
/** @typedef {LiteralSegment | VariableSegment | InstructionSegment} TemplateSegment */

/**
 * Split `str` on top-level `|` characters — i.e. not inside a `"..."` quoted string or
 * `(...)` parenthesized filter-arg group. Never throws; an unterminated quote/paren is
 * simply included verbatim in whichever part it started in.
 * @param {string} str
 * @returns {string[]}
 */
function splitTopLevelPipes(str) {
    const parts = []
    let depth = 0
    let inQuotes = false
    let current = ""
    for (let i = 0; i < str.length; i++) {
        const ch = str[i]
        if (inQuotes) {
            current += ch
            if (ch === '"' && str[i - 1] !== "\\") {
                inQuotes = false
            }
            continue
        }
        if (ch === '"') {
            inQuotes = true
            current += ch
        } else if (ch === "(") {
            depth++
            current += ch
        } else if (ch === ")") {
            depth = Math.max(0, depth - 1)
            current += ch
        } else if (ch === "|" && depth === 0) {
            parts.push(current)
            current = ""
        } else {
            current += ch
        }
    }
    parts.push(current)
    return parts
}

/**
 * @param {string} str a double-quoted string starting at index 0 (the leading `"`)
 * @returns {string} the unescaped inner content
 */
function extractQuoted(str) {
    let result = ""
    let i = 1
    while (i < str.length) {
        const ch = str[i]
        if (ch === "\\" && i + 1 < str.length) {
            result += str[i + 1]
            i += 2
            continue
        }
        if (ch === '"') {
            break
        }
        result += ch
        i++
    }
    return result
}

/**
 * @param {string} part
 * @returns {FilterCall}
 */
function parseFilterCall(part) {
    const trimmed = part.trim()
    const colonIndex = trimmed.indexOf(":")
    if (colonIndex === -1) {
        return { name: trimmed, argsRaw: "" }
    }
    return { name: trimmed.slice(0, colonIndex).trim(), argsRaw: trimmed.slice(colonIndex + 1).trim() }
}

/**
 * @param {string} body the raw text between {{ and }}
 * @returns {VariableSegment | InstructionSegment}
 */
function parseTokenBody(body) {
    const parts = splitTopLevelPipes(body.trim())
    const head = (parts[0] || "").trim()
    const filters = parts.slice(1).map(parseFilterCall)

    if (head.startsWith('"')) {
        return { kind: "instruction", instruction: extractQuoted(head), filters }
    }
    return { kind: "variable", name: head, filters }
}

/**
 * Tokenize a template string into literal/variable/instruction segments. Never throws;
 * an unterminated `{{` (no matching `}}`) is left as part of a literal segment.
 * @param {string | undefined | null} templateString
 * @returns {TemplateSegment[]}
 */
export function parseTemplateSegments(templateString) {
    if (typeof templateString !== "string" || templateString === "") {
        return []
    }
    /** @type {TemplateSegment[]} */
    const segments = []
    const regex = /\{\{([\s\S]*?)\}\}/g
    let lastIndex = 0
    /** @type {RegExpExecArray | null} */
    let match
    while ((match = regex.exec(templateString)) !== null) {
        if (match.index > lastIndex) {
            segments.push({ kind: "literal", text: templateString.slice(lastIndex, match.index) })
        }
        segments.push(parseTokenBody(match[1]))
        lastIndex = regex.lastIndex
    }
    if (lastIndex < templateString.length) {
        segments.push({ kind: "literal", text: templateString.slice(lastIndex) })
    }
    return segments
}

// ---------------------------------------------------------------------------
// Timestamp validation — the single chokepoint every caller goes through to decide
// whether to print a "[M:SS]"/"[H:MM:SS]" suffix (used by the `timestamped` filter, and
// by interpreter.js's instruction-answer coercion for the same validation elsewhere).
// ---------------------------------------------------------------------------

const TIMESTAMP_REGEX = /^\d{1,3}:[0-5]\d(:[0-5]\d)?$/

/**
 * @param {unknown} timestamp
 * @returns {string} " [M:SS]"/" [H:MM:SS]" if valid, else ""
 */
export function formatTimestampSuffix(timestamp) {
    return typeof timestamp === "string" && TIMESTAMP_REGEX.test(timestamp) ? ` [${timestamp}]` : ""
}

/**
 * @param {unknown} assignee
 * @returns {string} " — Assignee" if a non-empty string, else ""
 */
export function formatAssigneeSuffix(assignee) {
    return typeof assignee === "string" && assignee.trim() ? ` — ${assignee.trim()}` : ""
}

/**
 * Render one resolved value (plain string, or a `{text, timestamp?, assignee?}` item
 * produced by a `timestamped`/`assigned`-tagged instruction) down to a plain string:
 * `text [timestamp] — Assignee`, each suffix independently omitted when absent. Never
 * throws.
 * @param {unknown} item
 * @returns {string}
 */
export function stringifyItem(item) {
    if (item && typeof item === "object" && "text" in item) {
        const text = typeof (/** @type {any} */ (item).text) === "string" ? /** @type {any} */ (item).text : ""
        return (
            text +
            formatTimestampSuffix(/** @type {any} */ (item).timestamp) +
            formatAssigneeSuffix(/** @type {any} */ (item).assignee)
        )
    }
    if (typeof item === "string") {
        return item
    }
    if (item === null || item === undefined) {
        return ""
    }
    return String(item)
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/**
 * @param {string} s
 * @returns {string}
 */
function unescapeQuoted(s) {
    return s.replace(/\\(.)/g, "$1")
}

/**
 * Strip a single layer of surrounding double quotes (and unescape), if present.
 * @param {string} s
 * @returns {string}
 */
function stripQuotes(s) {
    const t = (s || "").trim()
    if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
        return unescapeQuoted(t.slice(1, -1))
    }
    return t
}

/**
 * @param {unknown} value
 * @param {(s: string) => string} fn
 * @returns {unknown}
 */
function mapOrApply(value, fn) {
    if (Array.isArray(value)) {
        return value.map((v) => fn(stringifyItem(v)))
    }
    return fn(stringifyItem(value))
}

/**
 * `|list` (optional `"checkbox"` arg) — array or newline-separated string -> a
 * markdown-bulleted block, one `- item` (or `- [ ] item`) per line.
 * @param {unknown} value
 * @param {string} argsRaw
 * @returns {string}
 */
function filterList(value, argsRaw) {
    const checkbox = stripQuotes(argsRaw).trim().toLowerCase() === "checkbox"
    /** @type {string[]} */
    let items
    if (Array.isArray(value)) {
        items = value.map(stringifyItem)
    } else {
        const s = stringifyItem(value)
        items = s.includes("\n") ? s.split("\n").map((line) => line.trim()).filter(Boolean) : [s].filter(Boolean)
    }
    if (items.length === 0) {
        return ""
    }
    const prefix = checkbox ? "- [ ] " : "- "
    return items.map((i) => `${prefix}${i}`).join("\n")
}

/**
 * `|wikilink` — wrap in [[ ]]; array items each wrapped, joined with ", ".
 * @param {unknown} value
 * @returns {string}
 */
function filterWikilink(value) {
    if (Array.isArray(value)) {
        return value.map((v) => `[[${stringifyItem(v)}]]`).filter((s) => s !== "[[]]").join(", ")
    }
    const s = stringifyItem(value)
    return s ? `[[${s}]]` : ""
}

/**
 * `|kebab` — lowercase, non-alphanumeric runs -> single hyphen, trimmed.
 * @param {unknown} value
 * @returns {string}
 */
function filterKebab(value) {
    const s = Array.isArray(value) ? value.map(stringifyItem).join(" ") : stringifyItem(value)
    return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}

/**
 * `|date:"FORMAT"` — reformats a Date-parseable value using YYYY/MM/DD/HH/mm/ss tokens.
 * Unparseable input -> "" for that item, never throws.
 * @param {unknown} value
 * @param {string} argsRaw
 * @returns {unknown}
 */
function filterDateFormat(value, argsRaw) {
    const format = stripQuotes(argsRaw)
    /** @param {string} s */
    const apply = (s) => {
        const d = new Date(s)
        if (isNaN(d.getTime())) {
            return ""
        }
        return format
            .replace(/YYYY/g, String(d.getFullYear()))
            .replace(/MM/g, String(d.getMonth() + 1).padStart(2, "0"))
            .replace(/DD/g, String(d.getDate()).padStart(2, "0"))
            .replace(/HH/g, String(d.getHours()).padStart(2, "0"))
            .replace(/mm/g, String(d.getMinutes()).padStart(2, "0"))
            .replace(/ss/g, String(d.getSeconds()).padStart(2, "0"))
    }
    return Array.isArray(value) ? value.map((v) => apply(stringifyItem(v))) : apply(stringifyItem(value))
}

/**
 * @param {string} argsRaw e.g. `("pattern":"replacement")`
 * @returns {{pattern: string, replacement: string} | null}
 */
function parseReplaceArgs(argsRaw) {
    let s = argsRaw.trim()
    if (s.startsWith("(") && s.endsWith(")")) {
        s = s.slice(1, -1).trim()
    }
    const match = s.match(/^"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"$/)
    if (!match) {
        return null
    }
    return { pattern: unescapeQuoted(match[1]), replacement: unescapeQuoted(match[2]) }
}

/**
 * @param {string} pattern a plain string, or a `/regex/flags` literal
 * @returns {RegExp | string | null}
 */
function toRegexOrString(pattern) {
    const m = pattern.match(/^\/(.*)\/([a-z]*)$/i)
    if (m) {
        try {
            const flags = m[2].includes("g") ? m[2] : m[2] + "g"
            return new RegExp(m[1], flags)
        } catch {
            return null
        }
    }
    return pattern
}

/**
 * `|replace:("pattern":"replacement")` — pattern may be a plain string (all occurrences
 * replaced) or a `/regex/flags` literal (capture groups like $1 supported).
 * @param {unknown} value
 * @param {string} argsRaw
 * @returns {unknown}
 */
function filterReplace(value, argsRaw) {
    const parsed = parseReplaceArgs(argsRaw)
    if (!parsed) {
        return value
    }
    const replacer = toRegexOrString(parsed.pattern)
    if (replacer === null) {
        return value
    }
    /** @param {string} s */
    const apply = (s) => (replacer instanceof RegExp ? s.replace(replacer, parsed.replacement) : s.split(replacer).join(parsed.replacement))
    return Array.isArray(value) ? value.map((v) => apply(stringifyItem(v))) : apply(stringifyItem(value))
}

/**
 * `|slice:a,b` — Array/String.prototype.slice semantics; `b` optional.
 * @param {unknown} value
 * @param {string} argsRaw
 * @returns {unknown}
 */
function filterSlice(value, argsRaw) {
    const parts = argsRaw.split(",").map((s) => s.trim()).filter((s) => s !== "")
    const start = parts[0] !== undefined ? parseInt(parts[0], 10) : undefined
    const endRaw = parts[1] !== undefined ? parseInt(parts[1], 10) : undefined
    const end = endRaw !== undefined && !isNaN(endRaw) ? endRaw : undefined
    if (Array.isArray(value)) {
        return value.slice(start, end)
    }
    return stringifyItem(value).slice(start, end)
}

/**
 * `|join:"sep"` — array -> string; already-string input passes through unchanged.
 * @param {unknown} value
 * @param {string} argsRaw
 * @returns {unknown}
 */
function filterJoin(value, argsRaw) {
    const sep = stripQuotes(argsRaw)
    return Array.isArray(value) ? value.map(stringifyItem).join(sep) : stringifyItem(value)
}

/**
 * `|split:"sep"` — string -> array; already-array input passes through unchanged.
 * @param {unknown} value
 * @param {string} argsRaw
 * @returns {unknown}
 */
function filterSplit(value, argsRaw) {
    const sep = stripQuotes(argsRaw)
    if (Array.isArray(value)) {
        return value
    }
    return stringifyItem(value).split(sep).map((s) => s.trim()).filter(Boolean)
}

/**
 * `|timestamped` — converts a `{text, timestamp?, assignee?}` item (or array of them)
 * into its final `"text [M:SS] — Assignee"` string form (each suffix omitted
 * independently if missing/invalid). A no-op on values that are already plain strings,
 * so filter order (`|list|timestamped` vs `|timestamped|list`, and combined with
 * `|assigned` in either order) doesn't matter.
 * @param {unknown} value
 * @returns {unknown}
 */
function filterTimestamped(value) {
    return Array.isArray(value) ? value.map(stringifyItem) : stringifyItem(value)
}

/**
 * `|assigned` — same shape/behavior as `|timestamped` above, just the marker an
 * instruction's filter chain carries to request an `assignee` field. The actual
 * `— Assignee` encoding lives in stringifyItem() regardless of which of
 * `timestamped`/`assigned` triggered it, so this is likewise a passthrough formatter.
 * @param {unknown} value
 * @returns {unknown}
 */
function filterAssigned(value) {
    return Array.isArray(value) ? value.map(stringifyItem) : stringifyItem(value)
}

/** @type {Record<string, (value: unknown, argsRaw: string) => unknown>} */
const FILTER_IMPLS = {
    list: filterList,
    wikilink: filterWikilink,
    kebab: filterKebab,
    date: filterDateFormat,
    replace: filterReplace,
    slice: filterSlice,
    join: filterJoin,
    split: filterSplit,
    lower: (v) => mapOrApply(v, (s) => s.toLowerCase()),
    upper: (v) => mapOrApply(v, (s) => s.toUpperCase()),
    trim: (v) => mapOrApply(v, (s) => s.trim()),
    timestamped: filterTimestamped,
    assigned: filterAssigned,
}

/**
 * Apply a chain of filters left-to-right, then coerce the final result to a plain
 * string (arrays join with ", "; unknown filter names are a no-op passthrough). Never
 * throws.
 * @param {unknown} value
 * @param {FilterCall[]} filters
 * @returns {string}
 */
export function applyFilters(value, filters) {
    let current = value
    for (const f of filters || []) {
        const impl = FILTER_IMPLS[f.name]
        if (impl) {
            current = impl(current, f.argsRaw)
        }
    }
    return Array.isArray(current) ? current.map(stringifyItem).join(", ") : stringifyItem(current)
}
