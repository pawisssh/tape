import { test, describe } from "node:test"
import assert from "node:assert/strict"
import {
    extractJsonFromResponse,
    renderSummaryMarkdown,
    endpointOriginPattern,
    DEFAULT_LLM_ENDPOINT,
    DEFAULT_LLM_MODEL,
    DEFAULT_LLM_TIMEOUT_MS,
} from "../extension/obsidian/llm.js"

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

describe("renderSummaryMarkdown", () => {
    test("renders only the sections present, in fixed order: Summary, Key topics, Action items, Decisions, Open questions, Next steps", () => {
        const md = renderSummaryMarkdown({
            summary: "We discussed the roadmap.",
            topics: [{ heading: "Roadmap", points: ["Ship Phase 4", "Plan Phase 5"] }],
            actionItems: [{ task: "Write tests", owner: "Kane", dueDate: "2026-08-27" }],
            decisions: ["Go with local LLM enrichment"],
            openQuestions: ["Which model to recommend by default?"],
            nextSteps: ["Start Phase 5"],
        })

        const summaryIdx = md.indexOf("## Summary")
        const topicsIdx = md.indexOf("## Key topics")
        const actionItemsIdx = md.indexOf("## Action items")
        const decisionsIdx = md.indexOf("## Decisions")
        const openQuestionsIdx = md.indexOf("## Open questions")
        const nextStepsIdx = md.indexOf("## Next steps")

        assert.ok(summaryIdx !== -1)
        assert.ok(topicsIdx > summaryIdx)
        assert.ok(actionItemsIdx > topicsIdx)
        assert.ok(decisionsIdx > actionItemsIdx)
        assert.ok(openQuestionsIdx > decisionsIdx)
        assert.ok(nextStepsIdx > openQuestionsIdx)

        assert.ok(md.includes("### Roadmap"))
        assert.ok(md.includes("- Ship Phase 4"))
        assert.ok(md.includes("- [ ] Write tests (Owner: Kane, Due: 2026-08-27)"))
        assert.ok(md.includes("- Go with local LLM enrichment"))
        assert.ok(md.includes("- Which model to recommend by default?"))
        assert.ok(md.includes("- Start Phase 5"))
    })

    test("a response with only `summary` still produces a valid, shorter fragment with no other sections", () => {
        const md = renderSummaryMarkdown({ summary: "Just a quick chat." })
        assert.equal(md, "## Summary\n\nJust a quick chat.")
        assert.ok(!md.includes("## Key topics"))
        assert.ok(!md.includes("## Action items"))
        assert.ok(!md.includes("## Decisions"))
    })

    test("returns empty string when every field is empty/absent", () => {
        assert.equal(renderSummaryMarkdown({}), "")
        assert.equal(renderSummaryMarkdown({ summary: "", topics: [], actionItems: [], decisions: [], openQuestions: [], nextSteps: [] }), "")
    })

    test("returns empty string for null/undefined/non-object input, never throws", () => {
        assert.equal(renderSummaryMarkdown(null), "")
        assert.equal(renderSummaryMarkdown(undefined), "")
        assert.doesNotThrow(() => renderSummaryMarkdown("a string"))
        assert.equal(renderSummaryMarkdown("a string"), "")
        assert.doesNotThrow(() => renderSummaryMarkdown(42))
        assert.equal(renderSummaryMarkdown(42), "")
    })

    test("drops a topic missing a heading", () => {
        const md = renderSummaryMarkdown({ topics: [{ points: ["orphan point"] }] })
        assert.equal(md, "")
    })

    test("drops a topic with empty/missing points", () => {
        const md1 = renderSummaryMarkdown({ topics: [{ heading: "Empty topic", points: [] }] })
        assert.equal(md1, "")
        const md2 = renderSummaryMarkdown({ topics: [{ heading: "No points field" }] })
        assert.equal(md2, "")
    })

    test("drops individual malformed topics but keeps valid ones alongside them", () => {
        const md = renderSummaryMarkdown({
            topics: [
                { heading: "Valid", points: ["a point"] },
                { points: ["missing heading"] },
                { heading: "Also empty", points: [] },
                "not even an object",
                null,
            ],
        })
        assert.ok(md.includes("### Valid"))
        assert.ok(!md.includes("missing heading"))
        assert.ok(!md.includes("Also empty"))
    })

    test("action items render owner/dueDate only when present", () => {
        const md = renderSummaryMarkdown({
            actionItems: [
                { task: "No metadata" },
                { task: "Owner only", owner: "Alice" },
                { task: "Due only", dueDate: "Monday" },
                { task: "Both", owner: "Bob", dueDate: "Tuesday" },
            ],
        })
        assert.ok(md.includes("- [ ] No metadata"))
        assert.ok(md.includes("- [ ] Owner only (Owner: Alice)"))
        assert.ok(md.includes("- [ ] Due only (Due: Monday)"))
        assert.ok(md.includes("- [ ] Both (Owner: Bob, Due: Tuesday)"))
    })

    test("action items missing a task are dropped", () => {
        const md = renderSummaryMarkdown({ actionItems: [{ owner: "Alice" }, { task: "" }] })
        assert.equal(md, "")
    })

    test("malformed non-array fields don't crash the renderer and are treated as empty", () => {
        const md = renderSummaryMarkdown({
            summary: "Still works.",
            topics: "not an array",
            actionItems: { task: "wrong shape entirely" },
            decisions: 42,
            openQuestions: null,
            nextSteps: undefined,
        })
        assert.equal(md, "## Summary\n\nStill works.")
    })

    test("non-string entries inside decisions/openQuestions/nextSteps arrays are dropped, not crashed on", () => {
        const md = renderSummaryMarkdown({
            decisions: ["valid decision", 42, null, { not: "a string" }, ""],
        })
        assert.equal(md, "## Decisions\n\n- valid decision")
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

describe("defaults", () => {
    test("documented default endpoint, model, and timeout", () => {
        assert.equal(DEFAULT_LLM_ENDPOINT, "http://localhost:1234/v1/chat/completions")
        assert.equal(DEFAULT_LLM_MODEL, "")
        assert.equal(DEFAULT_LLM_TIMEOUT_MS, 90000)
    })
})
