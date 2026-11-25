import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"

const meeting = {
    meetingTitle: "Team sync: Q4", meetingSoftware: "Google Meet", meetingStartTimestamp: new Date(2026, 10, 25, 14, 30).toISOString(),
    meetingEndTimestamp: new Date(2026, 10, 25, 15, 0).toISOString(), chatMessages: [], webhookPostStatus: "new",
    transcript: [{ personName: "Ann", timestamp: new Date(2026, 10, 25, 14, 31).toISOString(), transcriptText: "สวัสดี launch" }],
}
let sync, local, downloads, reply
const originalFetch = globalThis.fetch

function area(get) {
    return {
        get(keys, cb) {
            const out = Object.fromEntries(keys.map((k) => [k, get()[k]]))
            return cb ? cb(out) : Promise.resolve(out)
        },
        set(items, cb) { Object.assign(get(), items); return cb ? cb() : Promise.resolve() },
    }
}
globalThis.chrome = {
    runtime: {},
    storage: { sync: area(() => sync), local: area(() => local) },
    downloads: { download: async (o) => { downloads.push(o); if (downloads.length === 1 && o.filename.includes("BAD")) throw new Error("bad name") } },
}
// Stands in for the IndexedDB-held handle.
let folder
globalThis.indexedDB = {
    open() {
        const request = {}
        queueMicrotask(() => {
            request.result = { close() {}, transaction() {
                const tx = { objectStore: () => ({ get: () => ({ result: folder }) }) }
                queueMicrotask(() => tx.oncomplete())
                return tx
            } }
            request.onsuccess()
        })
        return request
    },
}
function fakeFolder(files, permission = "granted") {
    return {
        queryPermission: async () => permission,
        async getFileHandle(name, options) {
            if (!(name in files) && !options?.create) throw Object.assign(new Error(), { name: "NotFoundError" })
            return { createWritable: async () => ({ write: async (c) => { files[name] = c }, close: async () => {} }) }
        },
    }
}
beforeEach(() => {
    sync = {}; local = { meetings: [structuredClone(meeting)] }; downloads = []; folder = undefined
    reply = { ok: true, json: async () => ({ choices: [{ message: { content: 'Title: "Launch plan"\n' } }] }) }
    globalThis.fetch = async () => { if (reply instanceof Error) throw reply; return reply }
})
afterEach(() => { globalThis.fetch = originalFetch })

const { downloadTranscript } = await import("../extension/background-script/exporters.js")
const { cleanFileTitle, titleExcerpt } = await import("../extension/obsidian/file-title.js")
const { resolveFilenameTemplate, DEFAULT_FILENAME_TEMPLATE } = await import("../extension/obsidian/markdown.js")

test("txt uses Echo's date, time and title naming in Downloads/Tape", async () => {
    await downloadTranscript(0)
    assert.equal(downloads[0].filename, "Tape/2026-11-25 14-30 Team sync_ Q4.txt")
    assert.match(decodeURIComponent(downloads[0].url), /สวัสดี launch/)
})
test("the foundation model names the file and the title is cached", async () => {
    sync.useFoundationModelTitles = true
    await downloadTranscript(0)
    assert.equal(downloads[0].filename, "Tape/2026-11-25 14-30 Launch plan.txt")
    assert.equal(local.meetings[0].fileTitle, "Launch plan")
})
test("a refused or unreachable model keeps the meeting's title", async () => {
    sync.useFoundationModelTitles = true
    for (reply of [{ ok: false, status: 403 }, new Error("down")]) {
        downloads = []
        await downloadTranscript(0)
        assert.equal(downloads[0].filename, "Tape/2026-11-25 14-30 Team sync_ Q4.txt")
    }
})
test("the chosen folder is written to without replacing a file", async () => {
    const files = { "2026-11-25 14-30 Team sync_ Q4.txt": "old" }
    folder = fakeFolder(files)
    await downloadTranscript(0)
    assert.equal(downloads.length, 0)
    assert.equal(files["2026-11-25 14-30 Team sync_ Q4.txt"], "old")
    assert.match(files["2026-11-25 14-30 Team sync_ Q4 (2).txt"], /launch/)
})
test("a lapsed folder permission falls back to Downloads and says so", async () => {
    folder = fakeFolder({}, "prompt")
    assert.match(await downloadTranscript(0), /needs access again/)
    assert.equal(downloads.length, 1)
})
test("a rejected name falls back to Transcript.txt", async () => {
    sync.obsidianFileNameTemplate = "BAD"
    await downloadTranscript(0)
    assert.equal(downloads[1].filename, "Tape/Transcript.txt")
})
test("the autosaved old default migrates, a custom template stays", () => {
    assert.equal(resolveFilenameTemplate('{{date}}-{{"a concise, engaging title for this meeting"|kebab}}-meeting-note'), DEFAULT_FILENAME_TEMPLATE)
    assert.equal(resolveFilenameTemplate("{{title}}"), "{{title}}")
})
test("titles lose a leading date; excerpts stay short", () => {
    assert.equal(cleanFileTitle("2026-11-25-Budget review"), "Budget review")
    assert.equal(cleanFileTitle(" \n"), undefined)
    assert.ok(titleExcerpt({ ...meeting, transcript: [{ ...meeting.transcript[0], transcriptText: "x".repeat(9000) }] }).length < 3010)
})
