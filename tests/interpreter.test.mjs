import { test, describe } from "node:test"
import assert from "node:assert/strict"
import {
    parseTemplateSegments,
    getMeetingVariables,
    applyFilters,
    collectInstructions,
    buildInterpreterUserPrompt,
    buildInstructionAnswers,
    resolveValue,
    resolvePropertyValue,
    formatTimestampSuffix,
    formatAssigneeSuffix,
    templateReferencesVariable,
    INTERPRETER_SYSTEM_PROMPT,
} from "../extension/obsidian/interpreter.js"

/** @returns {import("../types/index.js").Meeting} */
function makeMeeting(overrides = {}) {
    return {
        meetingSoftware: "Google Meet",
        meetingTitle: "Team sync",
        meetingStartTimestamp: "2026-08-26T10:00:00.000Z",
        meetingEndTimestamp: "2026-08-26T10:45:00.000Z",
        transcript: [
            { personName: "Priya", timestamp: "2026-08-26T10:00:00.000Z", transcriptText: "Hi everyone!" },
            { personName: "Carlos", timestamp: "2026-08-26T10:01:00.000Z", transcriptText: "Hello Priya!" },
        ],
        chatMessages: [],
        webhookPostStatus: "new",
        ...overrides,
    }
}

describe("parseTemplateSegments", () => {
    test("a plain literal string with no tokens", () => {
        assert.deepEqual(parseTemplateSegments("just text"), [{ kind: "literal", text: "just text" }])
    })

    test("a bare variable token", () => {
        assert.deepEqual(parseTemplateSegments("{{title}}"), [{ kind: "variable", name: "title", filters: [] }])
    })

    test("a variable token with filters", () => {
        const segs = parseTemplateSegments('{{title|kebab|slice:0,5}}')
        assert.equal(segs.length, 1)
        assert.equal(segs[0].kind, "variable")
        assert.equal(segs[0].name, "title")
        assert.deepEqual(segs[0].filters, [
            { name: "kebab", argsRaw: "" },
            { name: "slice", argsRaw: "0,5" },
        ])
    })

    test("a quoted instruction token", () => {
        const segs = parseTemplateSegments('{{"summarize this meeting"}}')
        assert.deepEqual(segs, [{ kind: "instruction", instruction: "summarize this meeting", filters: [] }])
    })

    test("a quoted instruction with a filter", () => {
        const segs = parseTemplateSegments('{{"summarize this meeting"|list}}')
        assert.equal(segs[0].kind, "instruction")
        assert.equal(segs[0].instruction, "summarize this meeting")
        assert.deepEqual(segs[0].filters, [{ name: "list", argsRaw: "" }])
    })

    test("literal text mixed with tokens, in order", () => {
        const segs = parseTemplateSegments("# {{title}}\n\nBy {{software}}.")
        assert.equal(segs.length, 5)
        assert.equal(segs[0].kind, "literal")
        assert.equal(segs[0].text, "# ")
        assert.equal(segs[1].kind, "variable")
        assert.equal(segs[1].name, "title")
        assert.equal(segs[2].kind, "literal")
        assert.equal(segs[3].kind, "variable")
        assert.equal(segs[3].name, "software")
        assert.equal(segs[4].kind, "literal")
        assert.equal(segs[4].text, ".")
    })

    test("an unterminated {{ degrades to literal text rather than throwing", () => {
        assert.doesNotThrow(() => parseTemplateSegments("hello {{unterminated"))
        const segs = parseTemplateSegments("hello {{unterminated")
        assert.equal(segs.length, 1)
        assert.equal(segs[0].kind, "literal")
    })

    test("empty/undefined/null input returns no segments, never throws", () => {
        assert.deepEqual(parseTemplateSegments(""), [])
        assert.deepEqual(parseTemplateSegments(/** @type {any} */ (undefined)), [])
        assert.deepEqual(parseTemplateSegments(/** @type {any} */ (null)), [])
    })

    test("a | inside a quoted instruction's own text doesn't split the instruction from its filters", () => {
        const segs = parseTemplateSegments('{{"answer with a | pipe in it"|list}}')
        assert.equal(segs[0].kind, "instruction")
        assert.equal(segs[0].instruction, "answer with a | pipe in it")
        assert.deepEqual(segs[0].filters, [{ name: "list", argsRaw: "" }])
    })

    test("a | inside a filter's parenthesized args doesn't split into extra filters", () => {
        const segs = parseTemplateSegments('{{url|replace:("a|b":"c")}}')
        assert.equal(segs[0].filters.length, 1)
        assert.equal(segs[0].filters[0].name, "replace")
    })
})

describe("getMeetingVariables", () => {
    test("resolves title/duration/platform from the meeting", () => {
        const vars = getMeetingVariables(makeMeeting())
        assert.equal(vars.title, "Team sync")
        assert.equal(vars.duration, "45m")
        assert.equal(vars.platform, "Google Meet")
        assert.equal(vars.meetingStart, "2026-08-26T10:00:00.000Z")
        assert.equal(vars.meetingEnd, "2026-08-26T10:45:00.000Z")
    })

    test("participants is an array of unique names in first-seen order", () => {
        const vars = getMeetingVariables(makeMeeting())
        assert.deepEqual(vars.participants, ["Priya", "Carlos"])
        assert.equal(vars.participantCount, "2")
    })

    test("date is today's date (ISO, YYYY-MM-DD), not the meeting's own date", () => {
        const vars = getMeetingVariables(makeMeeting())
        assert.match(/** @type {string} */ (vars.date), /^\d{4}-\d{2}-\d{2}$/)
    })

    test("transcript is the speaker-grouped body text with no heading of its own", () => {
        const vars = getMeetingVariables(makeMeeting())
        assert.ok(/** @type {string} */ (vars.transcript).includes("Priya"))
        assert.ok(!/** @type {string} */ (vars.transcript).includes("## Transcript"))
    })

    test("chatMessages is empty string when the meeting has no chat messages", () => {
        const vars = getMeetingVariables(makeMeeting({ chatMessages: [] }))
        assert.equal(vars.chatMessages, "")
    })

    test("chatMessages is the body text with no heading when present", () => {
        const vars = getMeetingVariables(
            makeMeeting({
                chatMessages: [{ personName: "Mo", timestamp: "2026-08-26T10:05:00.000Z", chatMessageText: "hi" }],
            }),
        )
        assert.ok(/** @type {string} */ (vars.chatMessages).includes("hi"))
        assert.ok(!/** @type {string} */ (vars.chatMessages).includes("## Chat messages"))
    })
})

describe("templateReferencesVariable", () => {
    test("finds a bare variable token", () => {
        assert.equal(templateReferencesVariable("## Transcript\n\n{{transcript}}", "transcript"), true)
    })

    test("finds it regardless of filters applied", () => {
        assert.equal(templateReferencesVariable("{{transcript|trim}}", "transcript"), true)
    })

    test("returns false when the variable isn't referenced", () => {
        assert.equal(templateReferencesVariable("{{title}}", "transcript"), false)
    })

    test("a quoted instruction with the same text as a variable name doesn't count", () => {
        assert.equal(templateReferencesVariable('{{"transcript"}}', "transcript"), false)
    })

    test("never throws on empty/undefined input", () => {
        assert.equal(templateReferencesVariable("", "transcript"), false)
        assert.equal(templateReferencesVariable(undefined, "transcript"), false)
    })
})

describe("applyFilters", () => {
    test("no filters returns the value stringified", () => {
        assert.equal(applyFilters("hi", []), "hi")
        assert.equal(applyFilters(["a", "b"], []), "a, b")
    })

    test("an unknown filter name is a no-op passthrough", () => {
        assert.equal(applyFilters("hi", [{ name: "not-a-real-filter", argsRaw: "" }]), "hi")
    })

    describe("list", () => {
        test("array of strings -> one '- item' bullet per line", () => {
            assert.equal(applyFilters(["a", "b"], [{ name: "list", argsRaw: "" }]), "- a\n- b")
        })

        test('list:"checkbox" -> "- [ ] item" bullets', () => {
            assert.equal(applyFilters(["a", "b"], [{ name: "list", argsRaw: '"checkbox"' }]), "- [ ] a\n- [ ] b")
        })

        test("a newline-separated plain string is split into bullets", () => {
            assert.equal(applyFilters("a\nb", [{ name: "list", argsRaw: "" }]), "- a\n- b")
        })

        test("empty array renders as empty string, not a dangling heading", () => {
            assert.equal(applyFilters([], [{ name: "list", argsRaw: "" }]), "")
        })
    })

    describe("wikilink", () => {
        test("scalar value wraps in [[ ]]", () => {
            assert.equal(applyFilters("Roadmap", [{ name: "wikilink", argsRaw: "" }]), "[[Roadmap]]")
        })

        test("array wraps each item, joined with ', '", () => {
            assert.equal(applyFilters(["a", "b"], [{ name: "wikilink", argsRaw: "" }]), "[[a]], [[b]]")
        })

        test("empty value renders as empty string, not [[]]", () => {
            assert.equal(applyFilters("", [{ name: "wikilink", argsRaw: "" }]), "")
        })
    })

    test("kebab lowercases and hyphenates", () => {
        assert.equal(applyFilters("Q3 Roadmap Review!", [{ name: "kebab", argsRaw: "" }]), "q3-roadmap-review")
    })

    describe("date", () => {
        test('date:"YYYY-MM-DD" reformats an ISO timestamp', () => {
            assert.equal(
                applyFilters("2026-08-26T10:00:00.000Z", [{ name: "date", argsRaw: '"YYYY-MM-DD"' }]),
                "2026-08-26",
            )
        })

        test("unparseable input resolves to empty string, never throws", () => {
            assert.doesNotThrow(() => applyFilters("not a date", [{ name: "date", argsRaw: '"YYYY-MM-DD"' }]))
            assert.equal(applyFilters("not a date", [{ name: "date", argsRaw: '"YYYY-MM-DD"' }]), "")
        })
    })

    describe("replace", () => {
        test("plain string pattern replaces all occurrences", () => {
            assert.equal(applyFilters("a-b-c", [{ name: "replace", argsRaw: '("-":"_")' }]), "a_b_c")
        })

        test("a /regex/flags pattern supports capture groups", () => {
            const out = applyFilters("https://facebook.com/someuser/posts/1", [
                { name: "replace", argsRaw: '("/^.*facebook\\.com\\/([^\\/]+).*$/":"$1")' },
            ])
            assert.equal(out, "someuser")
        })

        test("malformed args leaves the value unchanged rather than throwing", () => {
            assert.doesNotThrow(() => applyFilters("abc", [{ name: "replace", argsRaw: "not valid args" }]))
            assert.equal(applyFilters("abc", [{ name: "replace", argsRaw: "not valid args" }]), "abc")
        })
    })

    test("slice applies Array/String slice semantics", () => {
        assert.equal(applyFilters(["a", "b", "c", "d"], [{ name: "slice", argsRaw: "0,2" }]), "a, b")
        assert.equal(applyFilters("abcdef", [{ name: "slice", argsRaw: "0,3" }]), "abc")
    })

    test('join:"sep" turns an array into a string', () => {
        assert.equal(applyFilters(["a", "b"], [{ name: "join", argsRaw: '"-"' }]), "a-b")
    })

    test('split:"sep" turns a string into an array (then finalized with ", ")', () => {
        assert.equal(applyFilters("a-b-c", [{ name: "split", argsRaw: '"-"' }]), "a, b, c")
    })

    test("lower/upper/trim", () => {
        assert.equal(applyFilters("HeLLo", [{ name: "lower", argsRaw: "" }]), "hello")
        assert.equal(applyFilters("hello", [{ name: "upper", argsRaw: "" }]), "HELLO")
        assert.equal(applyFilters("  hi  ", [{ name: "trim", argsRaw: "" }]), "hi")
    })

    describe("timestamped", () => {
        test("a valid timestamp renders a trailing bracket", () => {
            const out = applyFilters({ text: "Ship it", timestamp: "4:32" }, [{ name: "timestamped", argsRaw: "" }])
            assert.equal(out, "Ship it [4:32]")
        })

        test("a missing timestamp renders with no bracket", () => {
            const out = applyFilters({ text: "Ship it" }, [{ name: "timestamped", argsRaw: "" }])
            assert.equal(out, "Ship it")
        })

        test("an invalid timestamp drops the bracket but keeps the text", () => {
            const out = applyFilters({ text: "Ship it", timestamp: "unknown" }, [{ name: "timestamped", argsRaw: "" }])
            assert.equal(out, "Ship it")
        })

        test("combined with list, each item gets its own bracket", () => {
            const out = applyFilters(
                [
                    { text: "First", timestamp: "1:00" },
                    { text: "Second", timestamp: "nope" },
                ],
                [{ name: "list", argsRaw: "" }, { name: "timestamped", argsRaw: "" }],
            )
            assert.equal(out, "- First [1:00]\n- Second")
        })

        test("filter order (timestamped before list, or after) produces the same result", () => {
            const items = [{ text: "First", timestamp: "1:00" }]
            const a = applyFilters(items, [{ name: "list", argsRaw: "" }, { name: "timestamped", argsRaw: "" }])
            const b = applyFilters(items, [{ name: "timestamped", argsRaw: "" }, { name: "list", argsRaw: "" }])
            assert.equal(a, b)
        })

        test("is a no-op on an already-plain string", () => {
            assert.equal(applyFilters("plain", [{ name: "timestamped", argsRaw: "" }]), "plain")
        })
    })

    describe("assigned", () => {
        test("a present assignee renders a trailing em-dash name", () => {
            const out = applyFilters({ text: "Ship it", assignee: "Kane" }, [{ name: "assigned", argsRaw: "" }])
            assert.equal(out, "Ship it — Kane")
        })

        test("a missing assignee renders with no suffix", () => {
            const out = applyFilters({ text: "Ship it" }, [{ name: "assigned", argsRaw: "" }])
            assert.equal(out, "Ship it")
        })

        test("combined with timestamped, both suffixes appear in order: timestamp then assignee", () => {
            const out = applyFilters({ text: "Ship it", timestamp: "4:32", assignee: "Kane" }, [
                { name: "timestamped", argsRaw: "" },
                { name: "assigned", argsRaw: "" },
            ])
            assert.equal(out, "Ship it [4:32] — Kane")
        })

        test("combined with list, each item gets its own assignee suffix", () => {
            const out = applyFilters(
                [
                    { text: "First", assignee: "Kane" },
                    { text: "Second" },
                ],
                [{ name: "list", argsRaw: "" }, { name: "assigned", argsRaw: "" }],
            )
            assert.equal(out, "- First — Kane\n- Second")
        })

        test("is a no-op on an already-plain string", () => {
            assert.equal(applyFilters("plain", [{ name: "assigned", argsRaw: "" }]), "plain")
        })
    })
})

describe("formatTimestampSuffix", () => {
    test("valid M:SS and H:MM:SS", () => {
        assert.equal(formatTimestampSuffix("4:32"), " [4:32]")
        assert.equal(formatTimestampSuffix("1:23:45"), " [1:23:45]")
    })

    test("invalid/non-string input returns empty string", () => {
        assert.equal(formatTimestampSuffix("not a timestamp"), "")
        assert.equal(formatTimestampSuffix(undefined), "")
        assert.equal(formatTimestampSuffix(42), "")
    })
})

describe("formatAssigneeSuffix", () => {
    test("a non-empty string renders ' — Name'", () => {
        assert.equal(formatAssigneeSuffix("Kane"), " — Kane")
    })

    test("trims surrounding whitespace", () => {
        assert.equal(formatAssigneeSuffix("  Kane  "), " — Kane")
    })

    test("empty/whitespace-only/non-string input returns empty string", () => {
        assert.equal(formatAssigneeSuffix(""), "")
        assert.equal(formatAssigneeSuffix("   "), "")
        assert.equal(formatAssigneeSuffix(undefined), "")
        assert.equal(formatAssigneeSuffix(42), "")
    })
})

describe("collectInstructions", () => {
    test("collects a single instruction from a property", () => {
        const template = { properties: [{ name: "topic", value: '{{"the main topic"}}', type: "text" }], noteContent: "" }
        const instructions = [...collectInstructions(template).values()]
        assert.equal(instructions.length, 1)
        assert.equal(instructions[0].instruction, "the main topic")
        assert.equal(instructions[0].id, "field_1")
    })

    test("dedupes identical instruction text used in multiple places, in first-seen id order", () => {
        const template = {
            properties: [
                { name: "a", value: '{{"same instruction"}}', type: "text" },
                { name: "b", value: '{{"different instruction"}}', type: "text" },
            ],
            noteContent: '{{"same instruction"|list}}',
        }
        const instructions = [...collectInstructions(template).values()]
        assert.equal(instructions.length, 2)
        assert.equal(instructions[0].instruction, "same instruction")
        assert.equal(instructions[0].id, "field_1")
        assert.equal(instructions[1].instruction, "different instruction")
        assert.equal(instructions[1].id, "field_2")
    })

    test("a shape flag (listShaped/timestamped/assigned) is the union across every usage of that instruction", () => {
        const template = {
            properties: [{ name: "a", value: '{{"shared"}}', type: "text" }],
            noteContent: '{{"shared"|list|timestamped|assigned}}',
        }
        const [instr] = [...collectInstructions(template).values()]
        assert.equal(instr.listShaped, true)
        assert.equal(instr.timestamped, true)
        assert.equal(instr.assigned, true)
    })

    test("assigned defaults to false when no usage applies the |assigned filter", () => {
        const template = { properties: [], noteContent: '{{"x"|list|timestamped}}' }
        const [instr] = [...collectInstructions(template).values()]
        assert.equal(instr.assigned, false)
    })

    test("bare variables never become instructions", () => {
        const template = { properties: [{ name: "a", value: "{{title}}", type: "text" }], noteContent: "{{duration}}" }
        assert.equal(collectInstructions(template).size, 0)
    })

    test("a template with no properties/noteContent never throws", () => {
        assert.doesNotThrow(() => collectInstructions({}))
        assert.equal(collectInstructions(/** @type {any} */ ({})).size, 0)
    })
})

describe("buildInterpreterUserPrompt / INTERPRETER_SYSTEM_PROMPT", () => {
    test("with no instructions, the prompt is just the transcript preamble", () => {
        const prompt = buildInterpreterUserPrompt(makeMeeting(), [])
        assert.ok(prompt.includes("Team sync"))
        assert.ok(prompt.includes("Priya"))
        assert.ok(!prompt.includes("Instructions"))
    })

    test("lists each instruction with its id and a shape hint", () => {
        const prompt = buildInterpreterUserPrompt(makeMeeting(), [
            { id: "field_1", instruction: "the main topic", listShaped: false, timestamped: false },
            { id: "field_2", instruction: "the decisions", listShaped: true, timestamped: true },
        ])
        assert.ok(prompt.includes("field_1"))
        assert.ok(prompt.includes("the main topic"))
        assert.ok(prompt.includes("field_2"))
        assert.ok(prompt.includes("the decisions"))
    })

    test("appends the selected output language, and nothing for auto", () => {
        const instructions = [{ id: "field_1", instruction: "the main topic", listShaped: false, timestamped: false }]
        const thai = buildInterpreterUserPrompt(makeMeeting(), instructions, "th")
        assert.ok(thai.trimEnd().endsWith("exactly as they appear in the transcript."))
        assert.ok(thai.includes("in Thai"))
        assert.equal(buildInterpreterUserPrompt(makeMeeting(), instructions, "auto"), buildInterpreterUserPrompt(makeMeeting(), instructions))
    })

    // This is the DEFAULT system prompt only — the Settings page's AI summary category
    // now lets a user fully replace it (extension/obsidian/store.js's
    // getObsidianSettings() falls back to this exact constant when that setting is
    // unset/empty; see enrichWithLlm() in llm.js, which sends whatever
    // settings.obsidianLlmSystemPrompt resolves to, not this constant directly).
    test("INTERPRETER_SYSTEM_PROMPT is the default system prompt and demands a single JSON object", () => {
        assert.ok(INTERPRETER_SYSTEM_PROMPT.includes("JSON object"))
        assert.equal(typeof INTERPRETER_SYSTEM_PROMPT, "string")
    })
})

describe("buildInstructionAnswers", () => {
    test("plain-string instruction reads the matching id", () => {
        const instructions = [{ id: "field_1", instruction: "the topic", listShaped: false, timestamped: false }]
        const answers = buildInstructionAnswers({ field_1: "Roadmap" }, instructions)
        assert.equal(answers.get("the topic"), "Roadmap")
    })

    test("list-shaped instruction coerces non-string array items to strings, drops empties", () => {
        const instructions = [{ id: "field_1", instruction: "items", listShaped: true, timestamped: false }]
        const answers = buildInstructionAnswers({ field_1: ["a", "", 3, null] }, instructions)
        assert.deepEqual(answers.get("items"), ["a", "3"])
    })

    test("timestamped instruction coerces to {text, timestamp?}, dropping items with no text", () => {
        const instructions = [{ id: "field_1", instruction: "x", listShaped: false, timestamped: true }]
        const answers = buildInstructionAnswers({ field_1: { text: "hi", timestamp: "1:00" } }, instructions)
        assert.deepEqual(answers.get("x"), { text: "hi", timestamp: "1:00" })
    })

    test("timestamped+list drops malformed items but keeps valid ones", () => {
        const instructions = [{ id: "field_1", instruction: "x", listShaped: true, timestamped: true }]
        const answers = buildInstructionAnswers(
            { field_1: [{ text: "ok", timestamp: "1:00" }, { timestamp: "2:00" }, null, "not an object"] },
            instructions,
        )
        assert.deepEqual(answers.get("x"), [{ text: "ok", timestamp: "1:00" }])
    })

    test("assigned instruction coerces to {text, assignee?}, dropping items with no text", () => {
        const instructions = [{ id: "field_1", instruction: "x", listShaped: false, timestamped: false, assigned: true }]
        const answers = buildInstructionAnswers({ field_1: { text: "task", assignee: "Kane" } }, instructions)
        assert.deepEqual(answers.get("x"), { text: "task", assignee: "Kane" })
    })

    test("timestamped+assigned+list combines all three fields per item", () => {
        const instructions = [{ id: "field_1", instruction: "x", listShaped: true, timestamped: true, assigned: true }]
        const answers = buildInstructionAnswers(
            { field_1: [{ text: "task", timestamp: "1:00", assignee: "Ford" }, { text: "task2" }] },
            instructions,
        )
        assert.deepEqual(answers.get("x"), [
            { text: "task", timestamp: "1:00", assignee: "Ford" },
            { text: "task2", timestamp: undefined, assignee: undefined },
        ])
    })

    test("an empty/whitespace assignee is dropped rather than kept as blank", () => {
        const instructions = [{ id: "field_1", instruction: "x", listShaped: false, timestamped: false, assigned: true }]
        const answers = buildInstructionAnswers({ field_1: { text: "task", assignee: "   " } }, instructions)
        assert.deepEqual(answers.get("x"), { text: "task", assignee: undefined })
    })

    test("a missing/malformed field degrades to an empty value of the expected shape, never throws", () => {
        const instructions = [
            { id: "field_1", instruction: "a", listShaped: false, timestamped: false },
            { id: "field_2", instruction: "b", listShaped: true, timestamped: false },
            { id: "field_3", instruction: "c", listShaped: false, timestamped: true },
        ]
        assert.doesNotThrow(() => buildInstructionAnswers({}, instructions))
        const answers = buildInstructionAnswers({}, instructions)
        assert.equal(answers.get("a"), "")
        assert.deepEqual(answers.get("b"), [])
        assert.deepEqual(answers.get("c"), { text: "" })
    })

    test("a null/non-object parsedJson never throws", () => {
        const instructions = [{ id: "field_1", instruction: "a", listShaped: false, timestamped: false }]
        assert.doesNotThrow(() => buildInstructionAnswers(null, instructions))
        assert.doesNotThrow(() => buildInstructionAnswers(undefined, instructions))
    })
})

describe("resolveValue", () => {
    test("substitutes a variable", () => {
        const ctx = { meetingVariables: { title: "Team sync" }, instructionAnswers: new Map() }
        assert.equal(resolveValue("# {{title}}", ctx), "# Team sync")
    })

    test("substitutes an instruction answer", () => {
        const ctx = { meetingVariables: {}, instructionAnswers: new Map([["the topic", "Roadmap"]]) }
        assert.equal(resolveValue('{{"the topic"}}', ctx), "Roadmap")
    })

    test("an unknown variable resolves to empty string, never throws", () => {
        const ctx = { meetingVariables: {}, instructionAnswers: new Map() }
        assert.doesNotThrow(() => resolveValue("{{doesNotExist}}", ctx))
        assert.equal(resolveValue("prefix-{{doesNotExist}}-suffix", ctx), "prefix--suffix")
    })

    test("a missing instruction answer resolves to empty string, never throws", () => {
        const ctx = { meetingVariables: {}, instructionAnswers: new Map() }
        assert.equal(resolveValue('{{"never asked"}}', ctx), "")
    })

    test("combines literal text, a variable, and an instruction in one template", () => {
        const ctx = {
            meetingVariables: { duration: "45m" },
            instructionAnswers: new Map([["a topic", "Roadmap"]]),
        }
        assert.equal(resolveValue('Met for {{duration}} about {{"a topic"}}.', ctx), "Met for 45m about Roadmap.")
    })

    test("empty template returns empty string", () => {
        const ctx = { meetingVariables: {}, instructionAnswers: new Map() }
        assert.equal(resolveValue("", ctx), "")
        assert.equal(resolveValue(undefined, ctx), "")
    })
})

describe("resolvePropertyValue", () => {
    test("type text/date/number/checkbox stays a single string", () => {
        const ctx = { meetingVariables: { title: "Team sync" }, instructionAnswers: new Map() }
        assert.equal(resolvePropertyValue("{{title}}", ctx, "text"), "Team sync")
    })

    test("type multitext splits the resolved string on commas", () => {
        const ctx = { meetingVariables: {}, instructionAnswers: new Map() }
        assert.deepEqual(resolvePropertyValue("clippings, facebook", ctx, "multitext"), ["clippings", "facebook"])
    })

    test("type multitext round-trips an array variable (joined then re-split)", () => {
        const ctx = { meetingVariables: { participants: ["Priya", "Carlos"] }, instructionAnswers: new Map() }
        assert.deepEqual(resolvePropertyValue("{{participants}}", ctx, "multitext"), ["Priya", "Carlos"])
    })

    test("type multitext with an empty resolved value is an empty array, not ['']", () => {
        const ctx = { meetingVariables: {}, instructionAnswers: new Map() }
        assert.deepEqual(resolvePropertyValue("", ctx, "multitext"), [])
    })
})
