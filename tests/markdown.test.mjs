import { test, describe } from "node:test"
import assert from "node:assert/strict"
import {
    buildFrontmatter,
    buildMarkdown,
    buildFilename,
    sanitizeFilenameComponent,
    groupTranscriptBySpeaker,
    renderTranscriptSection,
    renderChatSection,
    toYamlString,
    getParticipants,
    DEFAULT_FILENAME_TEMPLATE,
} from "../extension/obsidian/markdown.js"

/** @returns {import("../types/index.js").Meeting} */
function makeMeeting(overrides = {}) {
    return {
        meetingSoftware: "Google Meet",
        meetingTitle: "Team sync",
        meetingStartTimestamp: "2026-08-26T10:00:00.000Z",
        meetingEndTimestamp: "2026-08-26T10:45:00.000Z",
        transcript: [
            { personName: "Priya", timestamp: "2026-08-26T10:00:00.000Z", transcriptText: "Hi everyone!" },
            { personName: "Priya", timestamp: "2026-08-26T10:00:30.000Z", transcriptText: "Let's get started." },
            { personName: "Carlos", timestamp: "2026-08-26T10:01:00.000Z", transcriptText: "Hello Priya!" },
        ],
        chatMessages: [],
        webhookPostStatus: "new",
        ...overrides,
    }
}

describe("toYamlString / frontmatter YAML-injection safety", () => {
    test("wraps plain strings in double quotes", () => {
        assert.equal(toYamlString("Team sync"), '"Team sync"')
    })

    test("escapes embedded double quotes", () => {
        assert.equal(toYamlString('Say "hi"'), '"Say \\"hi\\""')
    })

    test("escapes backslashes", () => {
        assert.equal(toYamlString("C:\\path"), '"C:\\\\path"')
    })

    test("collapses newlines so multi-line injection can't add new YAML keys", () => {
        const malicious = "Normal title\ninjected_key: true"
        const out = toYamlString(malicious)
        assert.ok(!out.includes("\n"), "no raw newline should survive")
        assert.equal(out, '"Normal title injected_key: true"')
    })

    test("a title starting with '---' does not create a new YAML document boundary", () => {
        const out = toYamlString("---\nmalicious: true")
        // Still a single quoted scalar - no bare "---" line remains.
        assert.equal(out, '"--- malicious: true"')
    })

    test("a title containing ': ' does not get interpreted as a new mapping key", () => {
        const out = toYamlString("key: value")
        assert.equal(out, '"key: value"')
    })

    test("buildFrontmatter output starts and ends with --- fences and quotes all scalar values", () => {
        const meeting = makeMeeting({ meetingTitle: 'Weird: "title"\nwith injection: true' })
        const fm = buildFrontmatter(meeting)
        const lines = fm.split("\n")
        assert.equal(lines[0], "---")
        assert.equal(lines[lines.length - 1], "---")
        const titleLine = lines.find((l) => l.startsWith("title:"))
        assert.ok(titleLine)
        assert.ok(titleLine.startsWith('title: "'))
        assert.ok(!titleLine.includes("\n"))
    })

    test("buildFrontmatter includes title/date/start/end/duration/software/participants", () => {
        const meeting = makeMeeting()
        const fm = buildFrontmatter(meeting)
        for (const key of ["title:", "date:", "start:", "end:", "duration:", "software:", "participants:"]) {
            assert.ok(fm.includes(key), `frontmatter missing ${key}`)
        }
        assert.ok(fm.includes("45m"), "duration should be computed as 45m")
    })
})

describe("groupTranscriptBySpeaker", () => {
    test("merges consecutive turns from the same speaker", () => {
        const groups = groupTranscriptBySpeaker(makeMeeting().transcript)
        assert.equal(groups.length, 2)
        assert.equal(groups[0].personName, "Priya")
        assert.equal(groups[0].text, "Hi everyone!\nLet's get started.")
        assert.equal(groups[1].personName, "Carlos")
        assert.equal(groups[1].text, "Hello Priya!")
    })

    test("does not merge non-consecutive turns from the same speaker", () => {
        const transcript = [
            { personName: "A", timestamp: "t1", transcriptText: "one" },
            { personName: "B", timestamp: "t2", transcriptText: "two" },
            { personName: "A", timestamp: "t3", transcriptText: "three" },
        ]
        const groups = groupTranscriptBySpeaker(transcript)
        assert.equal(groups.length, 3)
        assert.equal(groups[0].personName, "A")
        assert.equal(groups[2].personName, "A")
        assert.equal(groups[2].text, "three")
    })

    test("empty transcript produces no groups", () => {
        assert.deepEqual(groupTranscriptBySpeaker([]), [])
    })
})

describe("renderTranscriptSection / renderChatSection", () => {
    test("renders a Transcript heading with grouped speaker turns", () => {
        const out = renderTranscriptSection(makeMeeting().transcript)
        assert.ok(out.startsWith("## Transcript"))
        assert.ok(out.includes("**Priya**"))
        assert.ok(out.includes("**Carlos**"))
    })

    test("empty transcript still renders a valid section, not blank", () => {
        const out = renderTranscriptSection([])
        assert.ok(out.includes("## Transcript"))
        assert.ok(out.length > "## Transcript".length)
    })

    test("renderChatSection returns empty string for no chat messages", () => {
        assert.equal(renderChatSection([]), "")
        assert.equal(renderChatSection(undefined), "")
    })

    test("renderChatSection renders when non-empty", () => {
        const out = renderChatSection([
            { personName: "Mo", timestamp: "2026-08-26T10:05:00.000Z", chatMessageText: "Can you share the slides?" },
        ])
        assert.ok(out.startsWith("## Chat messages"))
        assert.ok(out.includes("Can you share the slides?"))
    })
})

describe("buildMarkdown", () => {
    test("omits the Chat messages section when there are no chat messages", () => {
        const md = buildMarkdown(makeMeeting({ chatMessages: [] }))
        assert.ok(!md.includes("## Chat messages"))
        assert.ok(md.includes("## Transcript"))
    })

    test("includes the Chat messages section when present", () => {
        const md = buildMarkdown(makeMeeting({
            chatMessages: [{ personName: "Mo", timestamp: "2026-08-26T10:05:00.000Z", chatMessageText: "hello" }],
        }))
        assert.ok(md.includes("## Chat messages"))
    })

    test("starts with YAML frontmatter fence", () => {
        const md = buildMarkdown(makeMeeting())
        assert.ok(md.startsWith("---\n"))
    })
})

describe("getParticipants", () => {
    test("dedupes names across transcript and chat, preserving first-seen order", () => {
        const participants = getParticipants(
            [{ personName: "A", timestamp: "t", transcriptText: "x" }, { personName: "B", timestamp: "t", transcriptText: "y" }],
            [{ personName: "A", timestamp: "t", chatMessageText: "z" }, { personName: "C", timestamp: "t", chatMessageText: "w" }],
        )
        assert.deepEqual(participants, ["A", "B", "C"])
    })
})

describe("filename sanitization", () => {
    test("strips illegal filesystem characters", () => {
        const out = sanitizeFilenameComponent('a/b:c*d?e"f<g>h|i')
        assert.ok(!/[/:*?"<>|]/.test(out))
    })

    test("guards Windows reserved device names", () => {
        assert.equal(sanitizeFilenameComponent("CON"), "_")
        assert.equal(sanitizeFilenameComponent("con"), "_")
        assert.equal(sanitizeFilenameComponent("LPT1"), "_")
        // Not a false positive for names that merely contain a reserved word.
        assert.equal(sanitizeFilenameComponent("Consultation"), "Consultation")
    })

    test("strips leading/trailing dots", () => {
        const out = sanitizeFilenameComponent("..hidden..")
        assert.ok(!out.startsWith("."))
        assert.ok(!out.endsWith("."))
    })

    test("a '/' in a meeting title never becomes a path separator in the filename", () => {
        const meeting = makeMeeting({ meetingTitle: "Q3/Q4 planning" })
        const filename = buildFilename(DEFAULT_FILENAME_TEMPLATE, meeting)
        assert.ok(!filename.includes("/"), `filename should not contain '/': ${filename}`)
    })

    test("expands {{date}} {{time}} {{title}} {{software}} tokens", () => {
        const meeting = makeMeeting()
        const filename = buildFilename("{{date}} {{time}} {{title}} {{software}}", meeting)
        assert.ok(filename.includes("Team sync"))
        assert.ok(filename.includes("Google Meet"))
        assert.ok(filename.endsWith(".md"))
    })

    test("falls back to the default template when none is provided", () => {
        const meeting = makeMeeting()
        const filename = buildFilename(undefined, meeting)
        assert.ok(filename.includes("Team sync"))
    })

    test("a title containing '/ : # [ ]' produces a safe, non-empty filename", () => {
        // '/' and ':' are illegal in filenames on Windows/macOS/Linux and must be
        // stripped. '#', '[', ']' are legal filename characters on all three and are
        // intentionally left alone — this test only asserts the pipeline doesn't throw
        // and doesn't reintroduce a path separator or colon, matching MANUAL_TESTING.md's
        // "doesn't break anything" check for this exact title.
        const meeting = makeMeeting({ meetingTitle: '/ : # [ ]' })
        const filename = buildFilename(DEFAULT_FILENAME_TEMPLATE, meeting)
        assert.ok(filename.endsWith(".md"))
        assert.ok(filename.length > ".md".length)
        assert.ok(!filename.slice(0, -3).includes("/"))
        assert.ok(!filename.slice(0, -3).includes(":"))

        // Also confirm buildMarkdown (the full pipeline) doesn't throw for this title.
        assert.doesNotThrow(() => buildMarkdown(meeting))
    })

    test("truncates very long titles while preserving the .md extension", () => {
        const meeting = makeMeeting({ meetingTitle: "x".repeat(500) })
        const filename = buildFilename("{{title}}", meeting)
        assert.ok(filename.endsWith(".md"))
        assert.ok(filename.length <= 200, `filename too long: ${filename.length}`)
    })

    test("truncation never leaves a trailing dot or space before the extension", () => {
        // maxBaseLength is MAX_FILENAME_LENGTH(200) - ".md".length(3) = 197, so a dot
        // placed at index 196 (0-based) lands exactly as the last sliced character.
        const meeting = makeMeeting({ meetingTitle: "a".repeat(196) + "." + "b".repeat(20) })
        const filename = buildFilename("{{title}}", meeting)
        const base = filename.slice(0, -3)
        assert.ok(!base.endsWith("."), `truncated base ends with a dot: ${base}`)
    })

    test("an entirely-sanitized-away title falls back to a non-empty filename", () => {
        const meeting = makeMeeting({ meetingTitle: "///???***" })
        const filename = buildFilename("{{title}}", meeting)
        assert.ok(filename.length > ".md".length)
    })
})
