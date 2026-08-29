import { test, describe } from "node:test"
import assert from "node:assert/strict"
import {
    extractJsonFromResponse,
    endpointOriginPattern,
    estimateTokenCount,
    DEFAULT_LLM_TIMEOUT_MS,
    enrichWithLlm,
} from "../extension/obsidian/llm.js"

function makeMeeting(overrides) {
    return {
        meetingSoftware: "Google Meet",
        meetingTitle: "Standup",
        meetingStartTimestamp: "2024-01-01T09:00:00.000Z",
        meetingEndTimestamp: "2024-01-01T09:15:00.000Z",
        transcript: [],
        chatMessages: [],
        webhookPostStatus: "new",
        ...overrides,
    }
}

describe("extractJsonFromResponse", () => {
    test("parses plain JSON with no wrapping", () => {
        const parsed = extractJsonFromResponse('{"summary": "hi"}')
        assert.deepEqual(parsed, { summary: "hi" })
    })

    test("parses a ```json fenced block", () => {
        const raw = "```json\n{\"summary\": \"fenced\"}\n```"
        const parsed = extractJsonFromResponse(raw)
        assert.deepEqual(parsed, { summary: "fenced" })
    })

    test("parses a plain ``` fenced block (no json tag)", () => {
        const raw = "```\n{\"summary\": \"fenced-no-tag\"}\n```"
        const parsed = extractJsonFromResponse(raw)
        assert.deepEqual(parsed, { summary: "fenced-no-tag" })
    })

    test("strips a <think>...</think> reasoning block before the JSON", () => {
        const raw = "<think>let me consider the transcript...</think>\n{\"summary\": \"after think\"}"
        const parsed = extractJsonFromResponse(raw)
        assert.deepEqual(parsed, { summary: "after think" })
    })

    test("strips a <think> block that itself contains braces", () => {
        const raw = "<think>the user said {something} confusing</think>{\"summary\": \"ok\"}"
        const parsed = extractJsonFromResponse(raw)
        assert.deepEqual(parsed, { summary: "ok" })
    })

    test("extracts JSON surrounded by chatty preamble and postamble text", () => {
        const raw = "Sure! Here is the meeting summary you asked for:\n\n{\"summary\": \"chatty\"}\n\nLet me know if you need anything else!"
        const parsed = extractJsonFromResponse(raw)
        assert.deepEqual(parsed, { summary: "chatty" })
    })

    test("returns null for malformed/truncated JSON", () => {
        const parsed = extractJsonFromResponse('{"summary": "truncated devices...')
        assert.equal(parsed, null)
    })

    test("returns null for a bare JSON array (not an object)", () => {
        const parsed = extractJsonFromResponse('["decision one", "decision two"]')
        assert.equal(parsed, null)
    })

    test("returns null for a bare JSON string", () => {
        const parsed = extractJsonFromResponse('"just a string"')
        assert.equal(parsed, null)
    })

    test("returns null for empty/whitespace input", () => {
        assert.equal(extractJsonFromResponse(""), null)
        assert.equal(extractJsonFromResponse("   \n  "), null)
    })

    test("returns null for null/undefined input", () => {
        assert.equal(extractJsonFromResponse(null), null)
        assert.equal(extractJsonFromResponse(undefined), null)
    })

    test("never throws on garbage input", () => {
        assert.doesNotThrow(() => extractJsonFromResponse("{{{{{"))
        assert.doesNotThrow(() => extractJsonFromResponse("not json at all"))
        assert.equal(extractJsonFromResponse("{{{{{"), null)
        assert.equal(extractJsonFromResponse("not json at all"), null)
    })

    test("handles braces embedded inside string values without breaking the scan", () => {
        const raw = 'Notes: {"summary": "the plan uses a { symbol } here", "decisions": []}'
        const parsed = extractJsonFromResponse(raw)
        assert.deepEqual(parsed, { summary: "the plan uses a { symbol } here", decisions: [] })
    })

    test("picks the full multi-field object, not just a fragment", () => {
        const raw = JSON.stringify({
            title: "Standup",
            summary: "Quick sync.",
            topics: [{ heading: "Blockers", points: ["None"] }],
            actionItems: [{ task: "Ship it", owner: "Kane", dueDate: "Friday" }],
            decisions: ["Ship on Friday"],
            openQuestions: [],
            nextSteps: ["Deploy"],
        })
        const parsed = extractJsonFromResponse(`preamble\n${raw}\npostamble`)
        assert.equal(parsed.title, "Standup")
        assert.equal(parsed.actionItems[0].owner, "Kane")
    })
})

describe("endpointOriginPattern", () => {
    test("derives a port-less origin match pattern from a localhost endpoint", () => {
        assert.equal(endpointOriginPattern("http://localhost:1234/v1/chat/completions"), "http://localhost/*")
        assert.equal(endpointOriginPattern("http://localhost:11434/v1/chat/completions"), "http://localhost/*")
    })

    test("returns null for an unparseable endpoint", () => {
        assert.equal(endpointOriginPattern("not a url"), null)
    })
})

describe("estimateTokenCount", () => {
    test("estimates roughly length/4 tokens, rounded up", () => {
        assert.equal(estimateTokenCount("12345678"), 2)
        assert.equal(estimateTokenCount("123456789"), 3)
    })

    test("returns 0 for empty string", () => {
        assert.equal(estimateTokenCount(""), 0)
    })

    test("never throws on non-string input", () => {
        assert.equal(estimateTokenCount(/** @type {any} */ (null)), 0)
        assert.equal(estimateTokenCount(/** @type {any} */ (undefined)), 0)
        assert.equal(estimateTokenCount(/** @type {any} */ (42)), 0)
    })
})

describe("defaults", () => {
    test("documented default timeout", () => {
        assert.equal(DEFAULT_LLM_TIMEOUT_MS, 300000)
    })
})

describe("enrichWithLlm - templateOverrideId resolution", () => {
    // Both templates below are deliberately variable-only (no {{"instruction"}}
    // tokens), so enrichWithLlm never actually hits the network — collectInstructions()
    // finds nothing to ask the model, and the function resolves purely from
    // meeting/settings data. This keeps the test fast and offline while still exercising
    // the real overrideId-vs-keyword-match branch in enrichWithLlm.
    const keywordMatchTemplate = {
        id: "keyword-match",
        name: "Keyword match",
        keywords: "standup",
        properties: [],
        noteContent: "KEYWORD-MATCH-CONTENT",
    }
    const overrideTemplate = {
        id: "override-id",
        name: "Override",
        keywords: "",
        properties: [],
        noteContent: "OVERRIDE-CONTENT",
    }
    const baseSettings = {
        obsidianUseLlm: true,
        obsidianLlmEndpoint: "http://localhost:1/v1/chat/completions",
        obsidianLlmModel: "",
        obsidianLlmSummaryTemplates: [keywordMatchTemplate, overrideTemplate],
    }

    test("a valid templateOverrideId short-circuits the automatic keyword match", async () => {
        const meeting = makeMeeting({ templateOverrideId: "override-id" })
        const result = await enrichWithLlm(meeting, baseSettings)
        assert.ok(result && !("contextExceeded" in result))
        assert.equal(result.summaryMarkdown, "OVERRIDE-CONTENT")
    })

    test("a stale templateOverrideId (deleted template) falls through to the keyword match", async () => {
        const meeting = makeMeeting({ templateOverrideId: "no-longer-exists" })
        const result = await enrichWithLlm(meeting, baseSettings)
        assert.ok(result && !("contextExceeded" in result))
        assert.equal(result.summaryMarkdown, "KEYWORD-MATCH-CONTENT")
    })

    test("no templateOverrideId at all uses the automatic keyword match, unchanged", async () => {
        const meeting = makeMeeting()
        const result = await enrichWithLlm(meeting, baseSettings)
        assert.ok(result && !("contextExceeded" in result))
        assert.equal(result.summaryMarkdown, "KEYWORD-MATCH-CONTENT")
    })

    // A user-customized "Default" template (see TemplatesView.tsx's pinned first row) is
    // just another entry in obsidianLlmSummaryTemplates with the reserved id "default" —
    // resolveDefaultTemplate() (templates.js) must prefer it over the hardcoded
    // DEFAULT_TEMPLATE constant in both places enrichWithLlm falls back to "the default".
    const customizedDefaultTemplate = {
        id: "default",
        name: "Default",
        keywords: "",
        properties: [],
        noteContent: "CUSTOM-DEFAULT-CONTENT",
    }

    test("templateOverrideId === \"default\" resolves to the user's customized default, not the hardcoded one", async () => {
        const meeting = makeMeeting({ templateOverrideId: "default" })
        const settings = { ...baseSettings, obsidianLlmSummaryTemplates: [keywordMatchTemplate, customizedDefaultTemplate] }
        const result = await enrichWithLlm(meeting, settings)
        assert.ok(result && !("contextExceeded" in result))
        assert.equal(result.summaryMarkdown, "CUSTOM-DEFAULT-CONTENT")
    })

    test("with no keyword match, a saved customized default is still picked up end-to-end (via resolveTemplateForTitle's own empty-keywords fallback, same as any other keyword-less template)", async () => {
        const meeting = makeMeeting({ meetingTitle: "Nothing matches this" })
        const settings = { ...baseSettings, obsidianLlmSummaryTemplates: [keywordMatchTemplate, customizedDefaultTemplate] }
        const result = await enrichWithLlm(meeting, settings)
        assert.ok(result && !("contextExceeded" in result))
        assert.equal(result.summaryMarkdown, "CUSTOM-DEFAULT-CONTENT")
    })

    // The "no keyword match AND no keyword-less template saved at all" case falls back to
    // resolveDefaultTemplate()'s own hardcoded-DEFAULT_TEMPLATE branch — not exercised here
    // end-to-end since the real DEFAULT_TEMPLATE contains actual AI instructions (unlike
    // this describe block's deliberately variable-only fixtures) and would need a live/
    // mocked LLM endpoint; see tests/templates.test.mjs's own "resolveDefaultTemplate"
    // describe block for that branch in isolation.
})
