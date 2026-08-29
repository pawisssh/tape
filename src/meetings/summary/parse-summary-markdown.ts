// Parses the fixed markdown schema produced by extension/obsidian/llm.js's
// renderSummaryMarkdown() back into structured data for display. This is the read-side
// counterpart of that renderer — deliberately hand-rolled against the exact shapes it
// emits (### /## headings, `- [ ] text [ts]` checkboxes, `- text [ts]` bullets, `-
// **lead:** detail` takeaways) rather than a general markdown parser, since the schema is
// fully controlled by our own code and is never free-form user markdown.

export interface TimestampedItem {
    text: string
    timestamp?: string
}

export interface ActionItem {
    text: string
    timestamp?: string
    assignee?: string
    done: boolean
}

export interface Takeaway {
    lead: string
    detail: string
}

export interface Topic {
    heading: string
    points: TimestampedItem[]
}

export interface ParsedSummary {
    actionItems: ActionItem[]
    decisions: TimestampedItem[]
    openQuestions: TimestampedItem[]
    nextSteps: TimestampedItem[]
    keyTakeaways: Takeaway[]
    topics: Topic[]
}

// Matches the `[M:SS]`/`[H:MM:SS]` suffix formatTimestampSuffix() appends, right at the
// end of a line.
const TRAILING_TIMESTAMP = /\s*\[(\d{1,3}:[0-5]\d(?::[0-5]\d)?)\]\s*$/

function splitTimestamp(text: string): TimestampedItem {
    const match = text.match(TRAILING_TIMESTAMP)
    if (!match) {
        return { text: text.trim() }
    }
    return { text: text.slice(0, match.index).trim(), timestamp: match[1] }
}

function parseBulletLines(block: string): string[] {
    return block
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("- "))
        .map((line) => line.slice(2).trim())
}

// Matches the ` — Assignee` suffix formatAssigneeSuffix() appends, right at the end of
// a line (after any trailing timestamp — see stringifyItem's text+timestamp+assignee
// order in template-syntax.js).
const TRAILING_ASSIGNEE = /\s+—\s+(.+)$/

const CHECKBOX_PREFIX = /^\[( |x|X)\]\s*/

function parseActionItemLine(line: string): ActionItem {
    let rest = line
    let done = false
    const checkboxMatch = rest.match(CHECKBOX_PREFIX)
    if (checkboxMatch) {
        done = checkboxMatch[1].toLowerCase() === "x"
        rest = rest.slice(checkboxMatch[0].length)
    }

    let assignee: string | undefined
    const assigneeMatch = rest.match(TRAILING_ASSIGNEE)
    if (assigneeMatch) {
        assignee = assigneeMatch[1].trim()
        rest = rest.slice(0, assigneeMatch.index).trim()
    }

    const { text, timestamp } = splitTimestamp(rest)
    return { text, timestamp, assignee, done }
}

function parseActionItems(block: string): ActionItem[] {
    return parseBulletLines(block).map(parseActionItemLine)
}

/**
 * Flip the `- [ ]`/`- [x]` checkbox marker of the `itemIndex`-th bullet (0-based, in
 * document order) inside the "## Action items" section of `markdown`, leaving every
 * other character untouched. A no-op (returns `markdown` unchanged) if the section or
 * that index doesn't exist — never throws.
 * @param markdown the raw `meeting.llmSummaryMarkdown` string
 * @param itemIndex index into the parsed `actionItems` array
 */
export function toggleActionItemDone(markdown: string, itemIndex: number): string {
    if (!markdown) {
        return markdown
    }
    const lines = markdown.split("\n")
    let inSection = false
    let count = -1
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (/^##\s+/.test(line)) {
            inSection = /^##\s+Action items\s*$/i.test(line.trim())
            continue
        }
        if (!inSection) {
            continue
        }
        const match = line.match(/^(\s*-\s*)\[( |x|X)\](.*)$/)
        if (!match) {
            continue
        }
        count++
        if (count === itemIndex) {
            const isDone = match[2].toLowerCase() === "x"
            lines[i] = `${match[1]}[${isDone ? " " : "x"}]${match[3]}`
            break
        }
    }
    return lines.join("\n")
}

function parseTimestampedList(block: string): TimestampedItem[] {
    return parseBulletLines(block).map(splitTimestamp)
}

function parseKeyTakeaways(block: string): Takeaway[] {
    const takeaways: Takeaway[] = []
    for (const line of parseBulletLines(block)) {
        const match = line.match(/^\*\*(.+?):\*\*\s*(.+)$/)
        if (match) {
            takeaways.push({ lead: match[1].trim(), detail: match[2].trim() })
        }
    }
    return takeaways
}

function parseTopics(block: string): Topic[] {
    const topics: Topic[] = []
    // Each topic is its own "### heading\n\n<bullets>" chunk, separated by blank lines
    // the renderer joins with "\n\n" — split on the "### " marker itself.
    const chunks = block.split(/\n(?=### )/).filter((chunk) => chunk.trim().startsWith("### "))
    for (const chunk of chunks) {
        const headingMatch = chunk.match(/^###\s+(.+)$/m)
        if (!headingMatch) continue
        const points = parseTimestampedList(chunk)
        if (points.length === 0) continue
        topics.push({ heading: headingMatch[1].trim(), points })
    }
    return topics
}

/**
 * Split the full markdown fragment into its top-level "## Heading" sections, keyed by
 * the heading text with the body (everything after the heading line, up to the next "##
 * " heading) as the value.
 */
function splitTopLevelSections(markdown: string): Map<string, string> {
    const sections = new Map<string, string>()
    const chunks = markdown.split(/\n(?=## )/).filter((chunk) => chunk.trim().startsWith("## "))
    for (const chunk of chunks) {
        const headingMatch = chunk.match(/^##\s+(.+)$/m)
        if (!headingMatch) continue
        sections.set(headingMatch[1].trim(), chunk)
    }
    return sections
}

/**
 * @param markdown the raw `meeting.llmSummaryMarkdown` string (may be undefined/empty)
 */
export function parseSummaryMarkdown(markdown: string | undefined): ParsedSummary {
    const empty: ParsedSummary = {
        actionItems: [],
        decisions: [],
        openQuestions: [],
        nextSteps: [],
        keyTakeaways: [],
        topics: [],
    }
    if (!markdown || !markdown.trim()) {
        return empty
    }

    const sections = splitTopLevelSections(markdown)

    return {
        actionItems: parseActionItems(sections.get("Action items") ?? ""),
        decisions: parseTimestampedList(sections.get("Decisions made") ?? ""),
        openQuestions: parseTimestampedList(sections.get("Open questions") ?? ""),
        nextSteps: parseTimestampedList(sections.get("Next steps") ?? ""),
        keyTakeaways: parseKeyTakeaways(sections.get("Key Takeaways") ?? ""),
        topics: parseTopics(sections.get("Topics") ?? ""),
    }
}

export function isSummaryEmpty(summary: ParsedSummary): boolean {
    return (
        summary.actionItems.length === 0 &&
        summary.decisions.length === 0 &&
        summary.openQuestions.length === 0 &&
        summary.nextSteps.length === 0 &&
        summary.keyTakeaways.length === 0 &&
        summary.topics.length === 0
    )
}
