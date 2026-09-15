import { test, describe } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(__dirname, "..")

const PLATFORM_INDEX_FILES = [
    "extension/content-scripts/google-meet/index.js",
    "extension/content-scripts/teams/index.js",
    "extension/content-scripts/zoom/index.js",
]

// The floating widget's note panel (extension/content-scripts/common-utils.js's
// renderNotePanel()) writes new comment notes straight to
// chrome.storage.local.liveCommentNotes — it never goes through the in-memory
// ContentScriptState `state` object the way transcript/chatMessages do (those get pushed
// to both `state.X` and storage on every update, so re-flushing `state.X` at meeting end is
// safe). `state.liveCommentNotes` is therefore always the pristine `[]` from
// createContentScriptState(), for the entire meeting. If a platform's meeting-end flush
// call includes "liveCommentNotes", it overwrites the real, live-saved notes with that
// stale empty array right before the background script reads storage to finalize the
// meeting — silently discarding every note the user typed. See tests/meetings.test.mjs for
// the (correct, already-covered) merge step on the other side of this handoff.
describe("meeting-end overWriteChromeStorage calls never include liveCommentNotes", () => {
    for (const relativePath of PLATFORM_INDEX_FILES) {
        test(`${relativePath} does not flush liveCommentNotes when the meeting ends`, () => {
            const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8")

            // The meeting-end flush is the one that also sends the download message (its
            // third argument is `true`) and lists "transcript"/"chatMessages" — distinct
            // from the meeting-start reset (third argument `false`), which legitimately
            // must include "liveCommentNotes" to clear any leftover notes from a prior
            // meeting.
            const endOfMeetingFlushCalls = source.match(/overWriteChromeStorage\([^)]*\],\s*true\)/g) || []
            assert.ok(endOfMeetingFlushCalls.length > 0, `expected to find at least one meeting-end flush call in ${relativePath}`)

            for (const call of endOfMeetingFlushCalls) {
                assert.ok(
                    !call.includes("liveCommentNotes"),
                    `meeting-end flush call must not include "liveCommentNotes" (found: ${call})`
                )
            }
        })
    }
})

// Direct proof of the underlying mechanism, exercising the real common-utils.js source
// (loaded as the classic, non-module script it actually is — it's shared, unbundled,
// global-scope JS across all three platforms' content scripts, so it has no exports to
// import) rather than a reimplemented copy.
describe("overWriteChromeStorage", () => {
    function loadCommonUtils() {
        const source = fs.readFileSync(path.join(repoRoot, "extension/content-scripts/common-utils.js"), "utf8")

        /** @type {{ local: Record<string, any> }} */
        const fakeStorageState = { local: {} }

        const sandbox = {
            console,
            document: { querySelector: () => null },
            chrome: {
                runtime: { sendMessage: (message, callback) => callback && callback({ success: true }) },
                storage: {
                    local: {
                        set(items, callback) {
                            Object.assign(fakeStorageState.local, items)
                            callback && callback()
                        },
                        get(keys, callback) {
                            const result = {}
                            keys.forEach((k) => { result[k] = fakeStorageState.local[k] })
                            callback(result)
                        },
                    },
                },
            },
        }
        vm.createContext(sandbox)
        new vm.Script(source, { filename: "common-utils.js" }).runInContext(sandbox)

        return { sandbox, fakeStorageState }
    }

    test("only writes the keys explicitly listed, leaving other storage keys untouched", () => {
        const { sandbox, fakeStorageState } = loadCommonUtils()
        fakeStorageState.local.liveCommentNotes = [{ timestamp: "t", text: "saved live by the note panel" }]

        const state = sandbox.createContentScriptState("Google Meet", "google_meet")
        state.transcript = [{ personName: "Alex", timestamp: "t", transcriptText: "hi" }]

        sandbox.overWriteChromeStorage(state, ["transcript", "chatMessages"], false)

        // Values that cross the vm sandbox boundary are a different realm's Array/Object,
        // so assert.deepEqual's identity checks misfire on them — compare via JSON instead.
        assert.equal(JSON.stringify(fakeStorageState.local.transcript), JSON.stringify(state.transcript))
        assert.equal(JSON.stringify(fakeStorageState.local.liveCommentNotes), JSON.stringify([{ timestamp: "t", text: "saved live by the note panel" }]))
    })

    test("including liveCommentNotes in keys overwrites it with state's stale value — demonstrates why the meeting-end flush must never list it", () => {
        const { sandbox, fakeStorageState } = loadCommonUtils()
        fakeStorageState.local.liveCommentNotes = [{ timestamp: "t", text: "saved live by the note panel" }]

        // state.liveCommentNotes is never populated — the note panel writes straight to
        // storage and never touches `state`.
        const state = sandbox.createContentScriptState("Google Meet", "google_meet")

        sandbox.overWriteChromeStorage(state, ["liveCommentNotes"], false)

        assert.equal(JSON.stringify(fakeStorageState.local.liveCommentNotes), "[]")
    })
})
