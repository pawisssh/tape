import { test, describe } from "node:test"
import assert from "node:assert/strict"

const { formatCommentNotesAsUserNotes } = await import("../extension/background-script/utils.js")

describe("formatCommentNotesAsUserNotes", () => {
    test("formats a single note with its timestamp header and text", () => {
        const result = formatCommentNotesAsUserNotes([
            { timestamp: "2026-01-01T21:41:00.000Z", text: "Follow up with Sam about pricing" },
        ])
        assert.match(result, /Follow up with Sam about pricing/)
        assert.match(result, /2026/)
    })

    test("joins multiple notes in order, each on its own header/text pair", () => {
        const result = formatCommentNotesAsUserNotes([
            { timestamp: "2026-01-01T21:41:00.000Z", text: "First note" },
            { timestamp: "2026-01-01T22:02:00.000Z", text: "Second note" },
        ])
        const firstIndex = result.indexOf("First note")
        const secondIndex = result.indexOf("Second note")
        assert.ok(firstIndex >= 0 && secondIndex >= 0)
        assert.ok(firstIndex < secondIndex)
    })

    test("an empty array returns an empty string", () => {
        const result = formatCommentNotesAsUserNotes([])
        assert.equal(result, "")
    })

    test("undefined input returns an empty string", () => {
        const result = formatCommentNotesAsUserNotes(undefined)
        assert.equal(result, "")
    })

    test("does not mutate the input array", () => {
        const notes = [{ timestamp: "2026-01-01T21:41:00.000Z", text: "Don't touch me" }]
        const original = JSON.parse(JSON.stringify(notes))
        formatCommentNotesAsUserNotes(notes)
        assert.deepEqual(notes, original)
    })
})
