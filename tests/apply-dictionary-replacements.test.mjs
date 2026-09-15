import { test, describe } from "node:test"
import assert from "node:assert/strict"

const { applyDictionaryReplacements } = await import("../extension/background-script/utils.js")

/**
 * @param {string} text
 * @returns {TranscriptBlock[]}
 */
function block(text) {
    return [{ personName: "Alex", timestamp: "2026-01-01T00:00:00.000Z", transcriptText: text }]
}

describe("applyDictionaryReplacements", () => {
    test("replaces a whole-word match case-insensitively", () => {
        const transcript = block("We should use zoom for this")
        const result = applyDictionaryReplacements(transcript, [{ id: "1", word: "zoom", replacement: "Zoom", categoryId: "uncategorized" }])
        assert.equal(result[0].transcriptText, "We should use Zoom for this")
    })

    test("does not replace inside a longer word", () => {
        const transcript = block("The room is zoomed in")
        const result = applyDictionaryReplacements(transcript, [{ id: "1", word: "zoom", replacement: "Zoom", categoryId: "uncategorized" }])
        assert.equal(result[0].transcriptText, "The room is zoomed in")
    })

    test("entries without a replacement are no-ops", () => {
        const transcript = block("kubernetes is great")
        const result = applyDictionaryReplacements(transcript, [{ id: "1", word: "kubernetes", categoryId: "uncategorized" }])
        assert.equal(result[0].transcriptText, "kubernetes is great")
    })

    test("entries with an empty/whitespace-only replacement are no-ops", () => {
        const transcript = block("kubernetes is great")
        const result = applyDictionaryReplacements(transcript, [{ id: "1", word: "kubernetes", replacement: "   ", categoryId: "uncategorized" }])
        assert.equal(result[0].transcriptText, "kubernetes is great")
    })

    test("a word containing regex-special characters is matched literally, not thrown on", () => {
        const transcript = block("I know C++ and C#")
        const result = applyDictionaryReplacements(transcript, [{ id: "1", word: "C++", replacement: "CPP", categoryId: "uncategorized" }])
        assert.equal(result[0].transcriptText, "I know CPP and C#")
    })

    test("multiple entries are each applied independently", () => {
        const transcript = block("k8s uses etcd internally")
        const words = [
            { id: "1", word: "k8s", replacement: "Kubernetes", categoryId: "uncategorized" },
            { id: "2", word: "etcd", replacement: "etcd (distributed key-value store)", categoryId: "uncategorized" },
        ]
        const result = applyDictionaryReplacements(transcript, words)
        assert.equal(result[0].transcriptText, "Kubernetes uses etcd (distributed key-value store) internally")
    })

    test("an empty word list returns a structurally equal but distinct array", () => {
        const transcript = block("nothing to replace here")
        const result = applyDictionaryReplacements(transcript, [])
        assert.deepEqual(result, transcript)
        assert.notEqual(result, transcript)
    })

    test("does not mutate the input transcript blocks", () => {
        const transcript = block("zoom call today")
        const original = JSON.parse(JSON.stringify(transcript))
        applyDictionaryReplacements(transcript, [{ id: "1", word: "zoom", replacement: "Zoom", categoryId: "uncategorized" }])
        assert.deepEqual(transcript, original)
    })

    test("replaces independently across multiple blocks, leaving personName/timestamp untouched", () => {
        const transcript = [
            { personName: "Alex", timestamp: "t1", transcriptText: "zoom is great" },
            { personName: "Sam", timestamp: "t2", transcriptText: "I agree about zoom" },
        ]
        const result = applyDictionaryReplacements(transcript, [{ id: "1", word: "zoom", replacement: "Zoom", categoryId: "uncategorized" }])
        assert.equal(result[0].transcriptText, "Zoom is great")
        assert.equal(result[1].transcriptText, "I agree about Zoom")
        assert.equal(result[0].personName, "Alex")
        assert.equal(result[1].timestamp, "t2")
    })
})
