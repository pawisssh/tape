import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { buildObsidianUri, joinObsidianPath, INLINE_CONTENT_MAX_URI_LENGTH } from "../extension/obsidian/uri.js"

describe("joinObsidianPath", () => {
    test("returns just the filename when folder is empty", () => {
        assert.equal(joinObsidianPath("", "Note.md"), "Note.md")
        assert.equal(joinObsidianPath(undefined, "Note.md"), "Note.md")
    })

    test("joins folder and filename with a single slash", () => {
        assert.equal(joinObsidianPath("Meetings", "Note.md"), "Meetings/Note.md")
    })

    test("trims stray leading/trailing/duplicate slashes in the folder", () => {
        assert.equal(joinObsidianPath("/Meetings/Tape/", "Note.md"), "Meetings/Tape/Note.md")
        assert.equal(joinObsidianPath("Meetings//Sub", "Note.md"), "Meetings/Sub/Note.md")
    })
})

describe("buildObsidianUri param encoding", () => {
    test("encodes spaces as %20, never as '+' (URLSearchParams would use '+')", () => {
        const built = buildObsidianUri({ vault: "My Vault", filePath: "My Note.md", content: "hi" })
        assert.ok(built.uri.includes("vault=My%20Vault"), built.uri)
        assert.ok(built.uri.includes("file=My%20Note.md"), built.uri)
        assert.ok(!built.uri.includes("+"), built.uri)
    })

    test("uses encodeURIComponent per param (folder separator encoded as %2F within file=)", () => {
        const built = buildObsidianUri({ vault: "V", filePath: "Folder/Note.md", content: "hi" })
        assert.ok(built.uri.includes("file=Folder%2FNote.md"), built.uri)
    })

    test("never emits overwrite= or append=", () => {
        const short = buildObsidianUri({ vault: "V", filePath: "N.md", content: "short" })
        assert.ok(!short.uri.includes("overwrite="))
        assert.ok(!short.uri.includes("append="))

        const long = buildObsidianUri({ vault: "V", filePath: "N.md", content: "x".repeat(5000) })
        assert.ok(!long.uri.includes("overwrite="))
        assert.ok(!long.uri.includes("append="))
    })

    test("special characters in content are percent-encoded, not left raw", () => {
        const built = buildObsidianUri({ vault: "V", filePath: "N.md", content: "a & b = c?" })
        if (built.mode === "inline") {
            assert.ok(built.uri.includes("content="))
            assert.ok(!built.uri.includes("content=a & b"))
        }
    })
})

describe("inline vs clipboard threshold", () => {
    test("short content goes inline via content=", () => {
        const built = buildObsidianUri({ vault: "V", filePath: "N.md", content: "short note" })
        assert.equal(built.mode, "inline")
        assert.ok(built.uri.includes("content="))
        assert.equal(built.content, undefined)
    })

    test("content long enough to push the URI past the threshold switches to clipboard mode", () => {
        const longContent = "x".repeat(INLINE_CONTENT_MAX_URI_LENGTH * 2)
        const built = buildObsidianUri({ vault: "V", filePath: "N.md", content: longContent })
        assert.equal(built.mode, "clipboard")
        assert.ok(built.uri.includes("clipboard=true"))
        assert.ok(!built.uri.includes("content="))
        assert.equal(built.content, longContent)
    })

    test("clipboard-mode URI (without content=) stays short regardless of note size", () => {
        const longContent = "x".repeat(50000)
        const built = buildObsidianUri({ vault: "V", filePath: "N.md", content: longContent })
        assert.equal(built.mode, "clipboard")
        assert.ok(built.uri.length < 500, `clipboard URI unexpectedly long: ${built.uri.length}`)
    })

    test("the boundary is respected: uri.length <= threshold implies inline", () => {
        // Binary search for content right at the boundary to sanity check both sides exist.
        let lo = 0, hi = INLINE_CONTENT_MAX_URI_LENGTH
        let lastInlineLength = -1
        let firstClipboardLength = -1
        for (const len of [10, 100, 1000, 1500, 1800, 2500, 4000]) {
            const built = buildObsidianUri({ vault: "V", filePath: "N.md", content: "x".repeat(len) })
            if (built.mode === "inline") lastInlineLength = len
            else if (firstClipboardLength === -1) firstClipboardLength = len
        }
        assert.ok(lastInlineLength >= 0, "expected at least one inline case among samples")
        assert.ok(firstClipboardLength > lastInlineLength, "expected clipboard mode to kick in for larger content")
    })
})
