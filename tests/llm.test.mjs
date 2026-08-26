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
    test("renders only the sections present, in fixed order: Action items, Decisions made, Open questions, Next steps, Key Takeaways, Topics", () => {
        const md = renderSummaryMarkdown({
            actionItems: [{ task: "Write tests", timestamp: "12:34" }],
            decisions: [{ text: "Go with local LLM enrichment", timestamp: "5:00" }],
            openQuestions: [{ text: "Which model to recommend by default?", timestamp: "8:15" }],
            nextSteps: [{ text: "Start Phase 5", timestamp: "40:00" }],
            keyTakeaways: [{ lead: "Ship it", detail: "The team agreed to ship by Friday." }],
            topics: [{ heading: "Roadmap", points: [{ text: "Ship Phase 4", timestamp: "1:00" }, { text: "Plan Phase 5" }] }],
        })

        const actionItemsIdx = md.indexOf("## Action items")
        const decisionsIdx = md.indexOf("## Decisions made")
        const openQuestionsIdx = md.indexOf("## Open questions")
        const nextStepsIdx = md.indexOf("## Next steps")
        const keyTakeawaysIdx = md.indexOf("## Key Takeaways")
        const topicsIdx = md.indexOf("## Topics")

        assert.ok(actionItemsIdx !== -1)
        assert.ok(decisionsIdx > actionItemsIdx)
        assert.ok(openQuestionsIdx > decisionsIdx)
        assert.ok(nextStepsIdx > openQuestionsIdx)
        assert.ok(keyTakeawaysIdx > nextStepsIdx)
        assert.ok(topicsIdx > keyTakeawaysIdx)

        assert.ok(md.includes("- [ ] Write tests [12:34]"))
        assert.ok(md.includes("- Go with local LLM enrichment [5:00]"))
        assert.ok(md.includes("- Which model to recommend by default? [8:15]"))
        assert.ok(md.includes("- Start Phase 5 [40:00]"))
        assert.ok(md.includes("- **Ship it:** The team agreed to ship by Friday."))
        assert.ok(md.includes("### Roadmap"))
        assert.ok(md.includes("- Ship Phase 4 [1:00]"))
        assert.ok(md.includes("- Plan Phase 5"))
        assert.ok(!md.includes("## Summary"))
    })

    test("returns empty string when every field is empty/absent", () => {
        assert.equal(renderSummaryMarkdown({}), "")
        assert.equal(renderSummaryMarkdown({
            actionItems: [],
            decisions: [],
            openQuestions: [],
            nextSteps: [],
            keyTakeaways: [],
            topics: [],
        }), "")
    })

    test("returns empty string for null/undefined/non-object input, never throws", () => {
        assert.equal(renderSummaryMarkdown(null), "")
        assert.equal(renderSummaryMarkdown(undefined), "")
        assert.doesNotThrow(() => renderSummaryMarkdown("a string"))
        assert.equal(renderSummaryMarkdown("a string"), "")
        assert.doesNotThrow(() => renderSummaryMarkdown(42))
        assert.equal(renderSummaryMarkdown(42), "")
    })

    test("only one section populated renders just that section, nothing else", () => {
        const md = renderSummaryMarkdown({ decisions: [{ text: "Just this one decision" }] })
        assert.equal(md, "## Decisions made\n\n- Just this one decision")
        assert.ok(!md.includes("## Action items"))
        assert.ok(!md.includes("## Open questions"))
        assert.ok(!md.includes("## Next steps"))
        assert.ok(!md.includes("## Key Takeaways"))
        assert.ok(!md.includes("## Topics"))
    })

    describe("action items", () => {
        test("renders a valid timestamp as a trailing bracket", () => {
            const md = renderSummaryMarkdown({ actionItems: [{ task: "Write tests", timestamp: "4:32" }] })
            assert.equal(md, "## Action items\n\n- [ ] Write tests [4:32]")
        })

        test("renders with no bracket at all when timestamp is missing", () => {
            const md = renderSummaryMarkdown({ actionItems: [{ task: "Write tests" }] })
            assert.equal(md, "## Action items\n\n- [ ] Write tests")
        })

        test("drops the bracket but keeps the text when timestamp is invalid", () => {
            const md = renderSummaryMarkdown({ actionItems: [{ task: "Write tests", timestamp: "unknown" }] })
            assert.equal(md, "## Action items\n\n- [ ] Write tests")
        })

        test("never renders an owner/due-date suffix even if the model hallucinates those keys", () => {
            const md = renderSummaryMarkdown({ actionItems: [{ task: "Write tests", owner: "Alice", dueDate: "Monday" }] })
            assert.equal(md, "## Action items\n\n- [ ] Write tests")
            assert.ok(!md.includes("Owner"))
            assert.ok(!md.includes("Due"))
        })

        test("items missing a task are dropped", () => {
            const md = renderSummaryMarkdown({ actionItems: [{ timestamp: "1:00" }, { task: "" }] })
            assert.equal(md, "")
        })
    })

    describe("decisions / open questions / next steps (shared timestamped-bullet shape)", () => {
        for (const [field, heading] of [
            ["decisions", "## Decisions made"],
            ["openQuestions", "## Open questions"],
            ["nextSteps", "## Next steps"],
        ]) {
            test(`${field}: valid timestamp renders a trailing bracket`, () => {
                const md = renderSummaryMarkdown({ [field]: [{ text: "Some text", timestamp: "2:05" }] })
                assert.equal(md, `${heading}\n\n- Some text [2:05]`)
            })

            test(`${field}: missing timestamp renders with no bracket`, () => {
                const md = renderSummaryMarkdown({ [field]: [{ text: "Some text" }] })
                assert.equal(md, `${heading}\n\n- Some text`)
            })

            test(`${field}: invalid timestamp drops the bracket but keeps the text`, () => {
                const md = renderSummaryMarkdown({ [field]: [{ text: "Some text", timestamp: "12:65" }] })
                assert.equal(md, `${heading}\n\n- Some text`)
            })

            test(`${field}: items missing text are dropped`, () => {
                const md = renderSummaryMarkdown({ [field]: [{ timestamp: "1:00" }, { text: "" }, "not an object", null] })
                assert.equal(md, "")
            })
        }
    })

    describe("Key Takeaways", () => {
        test("renders a correctly-formed bold lead-in", () => {
            const md = renderSummaryMarkdown({ keyTakeaways: [{ lead: "Ship it", detail: "The team agreed to ship by Friday." }] })
            assert.equal(md, "## Key Takeaways\n\n- **Ship it:** The team agreed to ship by Friday.")
            assert.ok(md.includes("- **Ship it:**"), "opening ** must be present, not dropped/broken")
        })

        test("trims stray trailing punctuation off lead to avoid a doubled colon", () => {
            const md = renderSummaryMarkdown({ keyTakeaways: [{ lead: "Ship it:", detail: "The team agreed." }] })
            assert.equal(md, "## Key Takeaways\n\n- **Ship it:** The team agreed.")
        })

        test("never renders a timestamp suffix even if the model supplies one", () => {
            const md = renderSummaryMarkdown({ keyTakeaways: [{ lead: "Ship it", detail: "By Friday.", timestamp: "5:00" }] })
            assert.equal(md, "## Key Takeaways\n\n- **Ship it:** By Friday.")
        })

        test("drops an item missing lead", () => {
            const md = renderSummaryMarkdown({ keyTakeaways: [{ detail: "Only detail, no lead." }] })
            assert.equal(md, "")
        })

        test("drops an item missing detail", () => {
            const md = renderSummaryMarkdown({ keyTakeaways: [{ lead: "Only lead, no detail" }] })
            assert.equal(md, "")
        })

        test("keeps valid items alongside dropped malformed ones", () => {
            const md = renderSummaryMarkdown({
                keyTakeaways: [
                    { lead: "Valid", detail: "This one renders." },
                    { lead: "No detail" },
                    { detail: "No lead" },
                    null,
                    "not an object",
                ],
            })
            assert.equal(md, "## Key Takeaways\n\n- **Valid:** This one renders.")
        })
    })

    describe("Topics", () => {
        test("drops a topic missing a heading", () => {
            const md = renderSummaryMarkdown({ topics: [{ points: [{ text: "orphan point" }] }] })
            assert.equal(md, "")
        })

        test("drops a topic with empty/missing points", () => {
            const md1 = renderSummaryMarkdown({ topics: [{ heading: "Empty topic", points: [] }] })
            assert.equal(md1, "")
            const md2 = renderSummaryMarkdown({ topics: [{ heading: "No points field" }] })
            assert.equal(md2, "")
        })

        test("points render with timestamp brackets, dropped/valid/invalid handled the same as other sections", () => {
            const md = renderSummaryMarkdown({
                topics: [{
                    heading: "Roadmap",
                    points: [
                        { text: "With timestamp", timestamp: "3:00" },
                        { text: "No timestamp" },
                        { text: "Bad timestamp", timestamp: "nope" },
                        { timestamp: "1:00" },
                    ],
                }],
            })
            assert.ok(md.includes("- With timestamp [3:00]"))
            assert.ok(md.includes("- No timestamp"))
            assert.ok(md.includes("- Bad timestamp"))
            assert.ok(!md.includes("- Bad timestamp [nope]"))
        })

        test("drops individual malformed topics but keeps valid ones alongside them", () => {
            const md = renderSummaryMarkdown({
                topics: [
                    { heading: "Valid", points: [{ text: "a point" }] },
                    { points: [{ text: "missing heading" }] },
                    { heading: "Also empty", points: [] },
                    "not even an object",
                    null,
                ],
            })
            assert.ok(md.includes("### Valid"))
            assert.ok(!md.includes("missing heading"))
            assert.ok(!md.includes("Also empty"))
        })
    })

    test("malformed non-array fields don't crash the renderer and are treated as empty", () => {
        const md = renderSummaryMarkdown({
            actionItems: { task: "wrong shape entirely" },
            decisions: 42,
            openQuestions: null,
            nextSteps: undefined,
            keyTakeaways: "not an array",
            topics: "not an array",
        })
        assert.equal(md, "")
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
