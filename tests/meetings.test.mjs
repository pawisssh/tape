import { test, describe, beforeEach } from "node:test"
import assert from "node:assert/strict"

// Minimal in-memory fake of the chrome.storage APIs meetings.js depends on (both local,
// for the transcript/meetings themselves, and sync, for the Dictionary words it now reads
// via extension/obsidian/dictionary.js) — same shape as store.test.mjs's fake.
/** @type {{ local: Record<string, any>, sync: Record<string, any> }} */
let fakeStorageState

function installFakeChrome() {
    fakeStorageState = { local: {}, sync: {} }

    function makeArea(areaName) {
        return {
            get(keys, callback) {
                const area = fakeStorageState[areaName]
                let result = {}
                if (keys === null || keys === undefined) {
                    result = { ...area }
                } else if (Array.isArray(keys)) {
                    for (const k of keys) result[k] = area[k]
                } else if (typeof keys === "string") {
                    result[keys] = area[keys]
                }
                queueMicrotask(() => callback(result))
            },
            set(items, callback) {
                Object.assign(fakeStorageState[areaName], items)
                queueMicrotask(() => callback && callback())
            },
        }
    }

    globalThis.chrome = {
        runtime: { lastError: undefined },
        storage: {
            local: makeArea("local"),
            sync: makeArea("sync"),
        },
    }
}

installFakeChrome()

const { pickupLastMeetingFromStorage } = await import("../extension/background-script/meetings.js")

beforeEach(() => {
    installFakeChrome()
})

function seedTranscript(transcriptText) {
    fakeStorageState.local.meetingSoftware = "Google Meet"
    fakeStorageState.local.meetingTitle = "Standup"
    fakeStorageState.local.meetingStartTimestamp = "2026-08-26T10:00:00.000Z"
    fakeStorageState.local.transcript = [{ personName: "Alex", timestamp: "2026-08-26T10:00:05.000Z", transcriptText }]
    fakeStorageState.local.chatMessages = []
}

describe("pickupLastMeetingFromStorage", () => {
    test("applies dictionary word replacements to the transcript before saving the meeting", async () => {
        seedTranscript("we should use k8s for this")
        fakeStorageState.sync.obsidianDictionaryWords = [
            { id: "1", word: "k8s", replacement: "Kubernetes", categoryId: "uncategorized" },
        ]

        await pickupLastMeetingFromStorage()

        const meetings = fakeStorageState.local.meetings
        assert.equal(meetings.length, 1)
        assert.equal(meetings[0].transcript[0].transcriptText, "we should use Kubernetes for this")
    })

    test("leaves the transcript unchanged when no dictionary words are configured", async () => {
        seedTranscript("we should use k8s for this")

        await pickupLastMeetingFromStorage()

        const meetings = fakeStorageState.local.meetings
        assert.equal(meetings[0].transcript[0].transcriptText, "we should use k8s for this")
    })

    test("merges live comment notes captured from the floating widget into userNotes", async () => {
        seedTranscript("we should use k8s for this")
        fakeStorageState.local.liveCommentNotes = [
            { timestamp: "2026-08-26T10:05:00.000Z", text: "Follow up with Sam about pricing" },
        ]

        await pickupLastMeetingFromStorage()

        const meetings = fakeStorageState.local.meetings
        assert.match(meetings[0].userNotes, /Follow up with Sam about pricing/)
    })

    test("leaves userNotes unset when no live comment notes were captured", async () => {
        seedTranscript("we should use k8s for this")

        await pickupLastMeetingFromStorage()

        const meetings = fakeStorageState.local.meetings
        assert.equal(meetings[0].userNotes, undefined)
    })
})
