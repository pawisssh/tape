import { test, beforeEach } from "node:test"
import assert from "node:assert/strict"

const meeting = {
    meetingTitle: "Team sync: Q4", meetingSoftware: "Google Meet", meetingStartTimestamp: new Date(2026, 10, 25, 14, 30).toISOString(),
    meetingEndTimestamp: new Date(2026, 10, 25, 15, 0).toISOString(), chatMessages: [], webhookPostStatus: "new",
    transcript: [{ personName: "Ann", timestamp: new Date(2026, 10, 25, 14, 31).toISOString(), transcriptText: "สวัสดี launch" }],
}
let sync, local, downloads

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
})

const { downloadTranscript } = await import("../extension/background-script/exporters.js")
const { cleanFileTitle } = await import("../extension/obsidian/file-title.js")
const { resolveFilenameTemplate, DEFAULT_FILENAME_TEMPLATE } = await import("../extension/obsidian/markdown.js")

test("md uses Echo's date, time and title naming in Downloads/Tape", async () => {
    await downloadTranscript(0)
    assert.equal(downloads[0].filename, "Tape/2026-11-25 14-30 Team sync_ Q4.md")
    assert.match(decodeURIComponent(downloads[0].url), /สวัสดี launch/)
})
test("the AI summary title names the file, without its date", async () => {
    local.meetings[0].llmSummaryTitle = "2026-11-25-Launch plan"
    await downloadTranscript(0)
    assert.equal(downloads[0].filename, "Tape/2026-11-25 14-30 Launch plan.md")
})
test("the chosen folder is written to without replacing a file", async () => {
    const files = { "2026-11-25 14-30 Team sync_ Q4.md": "old" }
    folder = fakeFolder(files)
    await downloadTranscript(0)
    assert.equal(downloads.length, 0)
    assert.equal(files["2026-11-25 14-30 Team sync_ Q4.md"], "old")
    assert.match(files["2026-11-25 14-30 Team sync_ Q4 (2).md"], /launch/)
})
test("a lapsed folder permission falls back to Downloads and says so", async () => {
    folder = fakeFolder({}, "prompt")
    assert.match(await downloadTranscript(0), /needs access again/)
    assert.equal(downloads.length, 1)
})
test("a rejected name falls back to Transcript.md", async () => {
    sync.obsidianFileNameTemplate = "BAD"
    await downloadTranscript(0)
    assert.equal(downloads[1].filename, "Tape/Transcript.md")
})
test("the autosaved old default migrates, a custom template stays", () => {
    assert.equal(resolveFilenameTemplate('{{date}}-{{"a concise, engaging title for this meeting"|kebab}}-meeting-note'), DEFAULT_FILENAME_TEMPLATE)
    assert.equal(resolveFilenameTemplate("{{title}}"), "{{title}}")
})
test("titles lose a leading date", () => {
    assert.equal(cleanFileTitle("2026-11-25-Budget review"), "Budget review")
    assert.equal(cleanFileTitle(" \n"), undefined)
})
