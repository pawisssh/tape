import { test, describe, beforeEach } from "node:test"
import assert from "node:assert/strict"

// Tests the Meeting lifecycle module (extension/background-script/meetings.js) through its
// three entry points only — meetingStarted / meetingEnded / recover — against an in-memory
// fake of the chrome.storage + chrome.tabs APIs it depends on, and a fake after-finalize
// effect that records what it was handed. See GLOSSARY.md for Live meeting / Finalize /
// Recovery.

/** @type {{ local: Record<string, any>, sync: Record<string, any> }} */
let fakeStorageState
/** @type {Set<number>} */
let openTabIds

function installFakeChrome() {
    fakeStorageState = { local: {}, sync: {} }
    openTabIds = new Set()

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
                queueMicrotask(() => callback(structuredClone(result)))
            },
            set(items, callback) {
                Object.assign(fakeStorageState[areaName], structuredClone(items))
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
        tabs: {
            get(tabId, callback) {
                queueMicrotask(() => {
                    if (openTabIds.has(tabId)) {
                        callback({ id: tabId })
                    } else {
                        globalThis.chrome.runtime.lastError = { message: `No tab with id: ${tabId}.` }
                        callback(undefined)
                        globalThis.chrome.runtime.lastError = undefined
                    }
                })
            },
        },
    }
}

installFakeChrome()

const { createMeetingLifecycle } = await import("../extension/background-script/meetings.js")

/** @type {Meeting[]} */
let handedToAfterFinalize
/** @type {(meeting: Meeting) => Promise<unknown>} */
let afterFinalizeBehaviour

function newLifecycle() {
    return createMeetingLifecycle({
        afterFinalize: (meeting) => {
            handedToAfterFinalize.push(meeting)
            return afterFinalizeBehaviour(meeting)
        },
    })
}

beforeEach(() => {
    installFakeChrome()
    handedToAfterFinalize = []
    afterFinalizeBehaviour = () => Promise.resolve()
})

const START = "2026-08-26T10:00:00.000Z"

function seedLiveMeeting(transcriptText, startTimestamp = START) {
    fakeStorageState.local.meetingSoftware = "Google Meet"
    fakeStorageState.local.meetingTitle = "Standup"
    fakeStorageState.local.meetingStartTimestamp = startTimestamp
    fakeStorageState.local.transcript = [{ personName: "Alex", timestamp: "2026-08-26T10:00:05.000Z", transcriptText }]
    fakeStorageState.local.chatMessages = []
}

describe("meetingEnded finalizes the live meeting", () => {
    test("saves the live meeting as a Meeting and hands it to the after-finalize effect", async () => {
        seedLiveMeeting("hello there")
        const lifecycle = newLifecycle()
        await lifecycle.meetingStarted(42)

        const result = await lifecycle.meetingEnded({ via: "message" })

        assert.equal(result.outcome, "finalized")
        const meetings = fakeStorageState.local.meetings
        assert.equal(meetings.length, 1)
        assert.equal(meetings[0].meetingTitle, "Standup")
        assert.equal(meetings[0].meetingStartTimestamp, START)
        assert.equal(meetings[0].transcript[0].transcriptText, "hello there")
        assert.equal(handedToAfterFinalize.length, 1)
        assert.equal(handedToAfterFinalize[0].meetingStartTimestamp, START)
    })
})

describe("the saved Meeting", () => {
    test("applies dictionary word replacements to the transcript", async () => {
        seedLiveMeeting("we should use k8s for this")
        fakeStorageState.sync.obsidianDictionaryWords = [
            { id: "1", word: "k8s", replacement: "Kubernetes", categoryId: "uncategorized" },
        ]

        await newLifecycle().meetingEnded({ via: "message" })

        assert.equal(fakeStorageState.local.meetings[0].transcript[0].transcriptText, "we should use Kubernetes for this")
    })

    test("leaves the transcript unchanged when no dictionary words are configured", async () => {
        seedLiveMeeting("we should use k8s for this")

        await newLifecycle().meetingEnded({ via: "message" })

        assert.equal(fakeStorageState.local.meetings[0].transcript[0].transcriptText, "we should use k8s for this")
    })

    test("merges live comment notes into userNotes", async () => {
        seedLiveMeeting("we should use k8s for this")
        fakeStorageState.local.liveCommentNotes = [
            { timestamp: "2026-08-26T10:05:00.000Z", text: "Follow up with Sam about pricing" },
        ]

        await newLifecycle().meetingEnded({ via: "message" })

        assert.match(fakeStorageState.local.meetings[0].userNotes, /Follow up with Sam about pricing/)
    })

    test("is saved even if only notes were captured", async () => {
        seedLiveMeeting("placeholder")
        fakeStorageState.local.transcript = []
        fakeStorageState.local.liveCommentNotes = [{ timestamp: "2026-08-26T10:05:00.000Z", text: "Remember the decision" }]

        await newLifecycle().meetingEnded({ via: "message" })

        assert.equal(fakeStorageState.local.meetings.length, 1)
        assert.equal(fakeStorageState.local.meetings[0].transcript.length, 0)
        assert.match(fakeStorageState.local.meetings[0].userNotes, /Remember the decision/)
    })

    test("keeps a note's selected speech", async () => {
        seedLiveMeeting("I can send the proposal tomorrow.")
        fakeStorageState.local.liveCommentNotes = [{
            timestamp: "2026-08-26T10:06:00.000Z",
            text: "Check the owner",
            linkedTranscript: {
                personName: "Alex",
                timestamp: "2026-08-26T10:00:05.000Z",
                transcriptText: "I can send the proposal tomorrow.",
                blockIndex: 0,
            },
        }]

        await newLifecycle().meetingEnded({ via: "message" })

        const notes = fakeStorageState.local.meetings[0].userNotes
        assert.match(notes, /Linked to Alex/)
        assert.match(notes, /I can send the proposal tomorrow\./)
        assert.match(notes, /Check the owner/)
    })

    test("leaves userNotes unset when no live comment notes were captured", async () => {
        seedLiveMeeting("we should use k8s for this")

        await newLifecycle().meetingEnded({ via: "message" })

        assert.equal(fakeStorageState.local.meetings[0].userNotes, undefined)
    })
})

describe("the meeting tab", () => {
    test("stays processing while the after-finalize effect runs, then clears", async () => {
        seedLiveMeeting("hello")
        const lifecycle = newLifecycle()
        await lifecycle.meetingStarted(42)
        assert.equal(fakeStorageState.local.meetingTabId, 42)

        /** @type {unknown[]} */
        const seenDuringEffect = []
        afterFinalizeBehaviour = async () => {
            seenDuringEffect.push(fakeStorageState.local.meetingTabId)
        }
        await lifecycle.meetingEnded({ via: "message" })

        assert.deepEqual(seenDuringEffect, ["processing"])
        assert.equal(fakeStorageState.local.meetingTabId, null)
    })
})

describe("end triggers", () => {
    test("the end-call message and the meeting tab closing together finalize once", async () => {
        seedLiveMeeting("hello")
        const lifecycle = newLifecycle()
        await lifecycle.meetingStarted(42)

        const [fromMessage, fromTabClose] = await Promise.all([
            lifecycle.meetingEnded({ via: "message" }),
            lifecycle.meetingEnded({ via: "tab-closed", tabId: 42 }),
        ])

        assert.equal(fakeStorageState.local.meetings.length, 1)
        assert.equal(handedToAfterFinalize.length, 1)
        assert.deepEqual([fromMessage.outcome, fromTabClose.outcome].sort(), ["finalized", "skipped"])
    })

    test("a tab closing that is not the meeting tab finalizes nothing", async () => {
        seedLiveMeeting("hello")
        const lifecycle = newLifecycle()
        await lifecycle.meetingStarted(42)

        const result = await lifecycle.meetingEnded({ via: "tab-closed", tabId: 7 })

        assert.deepEqual(result, { outcome: "skipped", reason: "not-meeting-tab" })
        assert.equal(fakeStorageState.local.meetings, undefined)
        assert.equal(fakeStorageState.local.meetingTabId, 42)
    })

    test("an after-finalize failure still saves the Meeting, once", async () => {
        seedLiveMeeting("hello")
        const lifecycle = newLifecycle()
        afterFinalizeBehaviour = () => Promise.reject({ errorCode: "010", errorMessage: "download failed" })

        const result = await lifecycle.meetingEnded({ via: "message" })
        const again = await lifecycle.recover("meetings-page")

        assert.equal(result.outcome, "finalized")
        assert.deepEqual(result.afterFinalizeError, { errorCode: "010", errorMessage: "download failed" })
        assert.deepEqual(again, { outcome: "skipped", reason: "already-finalized" })
        assert.equal(fakeStorageState.local.meetings.length, 1)
    })

    test("an empty live meeting saves nothing and is not retried", async () => {
        seedLiveMeeting("x")
        fakeStorageState.local.transcript = []
        const lifecycle = newLifecycle()

        const result = await lifecycle.meetingEnded({ via: "message" })
        const again = await lifecycle.recover("meetings-page")

        assert.deepEqual(result, { outcome: "skipped", reason: "empty" })
        assert.deepEqual(again, { outcome: "skipped", reason: "already-finalized" })
        assert.equal(fakeStorageState.local.meetings, undefined)
        assert.equal(handedToAfterFinalize.length, 0)
    })
})

/** Seeds a live meeting that was already finalized into `meetings`, the way a real end leaves storage. */
async function finalizeOneMeeting(startTimestamp = START) {
    seedLiveMeeting("hello", startTimestamp)
    await newLifecycle().meetingEnded({ via: "message" })
    handedToAfterFinalize = []
}

describe("recovery", () => {
    test("deleting the newest Meeting does not bring it back", async () => {
        await finalizeOneMeeting()
        fakeStorageState.local.meetings = []

        const result = await newLifecycle().recover("meetings-page")

        assert.deepEqual(result, { outcome: "skipped", reason: "already-finalized" })
        assert.deepEqual(fakeStorageState.local.meetings, [])
        assert.equal(handedToAfterFinalize.length, 0)
    })

    test("importing a transcript does not re-finalize the last live meeting", async () => {
        await finalizeOneMeeting()
        fakeStorageState.local.meetings.push({
            meetingSoftware: "", meetingTitle: "Imported", meetingStartTimestamp: "2020-01-01T00:00:00.000Z",
            meetingEndTimestamp: "2020-01-01T01:00:00.000Z", transcript: [], chatMessages: [], webhookPostStatus: "new",
        })

        const result = await newLifecycle().recover("meetings-page")

        assert.deepEqual(result, { outcome: "skipped", reason: "already-finalized" })
        assert.equal(fakeStorageState.local.meetings.length, 2)
    })

    test("a live meeting that never finalized is recovered", async () => {
        seedLiveMeeting("crashed mid-meeting")
        fakeStorageState.local.meetingTabId = 42 // tab no longer open

        const result = await newLifecycle().recover("startup")

        assert.equal(result.outcome, "finalized")
        assert.equal(fakeStorageState.local.meetings.length, 1)
        assert.equal(handedToAfterFinalize.length, 1)
        assert.equal(fakeStorageState.local.meetingTabId, null)
    })

    test("nothing live means nothing to recover", async () => {
        const result = await newLifecycle().recover("meetings-page")

        assert.deepEqual(result, { outcome: "skipped", reason: "nothing-live" })
    })

    test("the Meetings page does not recover a meeting still being captured", async () => {
        seedLiveMeeting("still talking")
        fakeStorageState.local.meetingTabId = 42
        openTabIds.add(42)

        const result = await newLifecycle().recover("meetings-page")

        assert.deepEqual(result, { outcome: "skipped", reason: "capturing" })
        assert.equal(fakeStorageState.local.meetings, undefined)
        assert.equal(fakeStorageState.local.meetingTabId, 42)
    })

    test("the Meetings page does not recover while finalization is processing", async () => {
        seedLiveMeeting("hello")
        fakeStorageState.local.meetingTabId = "processing"

        const result = await newLifecycle().recover("meetings-page")

        assert.deepEqual(result, { outcome: "skipped", reason: "finalizing" })
        assert.equal(fakeStorageState.local.meetings, undefined)
    })

    test("at browser startup, a processing state left by a crash is recovered", async () => {
        seedLiveMeeting("hello")
        fakeStorageState.local.meetingTabId = "processing"

        const result = await newLifecycle().recover("startup")

        assert.equal(result.outcome, "finalized")
        assert.equal(fakeStorageState.local.meetings.length, 1)
        assert.equal(fakeStorageState.local.meetingTabId, null)
    })

    test("recovery while this instance is finalizing is skipped", async () => {
        seedLiveMeeting("hello")
        const lifecycle = newLifecycle()
        /** @type {() => void} */
        let release = () => {}
        afterFinalizeBehaviour = () => new Promise((resolve) => { release = () => resolve(undefined) })

        const ending = lifecycle.meetingEnded({ via: "message" })
        await new Promise((resolve) => setTimeout(resolve, 0))
        const result = await lifecycle.recover("startup")
        release()
        await ending

        assert.deepEqual(result, { outcome: "skipped", reason: "finalizing" })
        assert.equal(fakeStorageState.local.meetings.length, 1)
    })
})

describe("recovery on a meeting join", () => {
    test("reloading the meeting tab finalizes the live meeting it was capturing", async () => {
        seedLiveMeeting("said before the reload")
        fakeStorageState.local.meetingTabId = 42
        openTabIds.add(42)

        const result = await newLifecycle().recover("meeting-join")

        assert.equal(result.outcome, "finalized")
        assert.equal(fakeStorageState.local.meetings[0].transcript[0].transcriptText, "said before the reload")
        assert.equal(fakeStorageState.local.meetingTabId, null)
    })

    test("joining in a second tab finalizes the first tab's live meeting", async () => {
        seedLiveMeeting("first meeting")
        fakeStorageState.local.meetingTabId = 42
        openTabIds.add(42)
        openTabIds.add(43)

        const result = await newLifecycle().recover("meeting-join")

        assert.equal(result.outcome, "finalized")
        assert.equal(fakeStorageState.local.meetings.length, 1)
    })
})

describe("upgrading from before the finalized marker", () => {
    test("a live meeting already in the list (not last) is not finalized again", async () => {
        seedLiveMeeting("hello")
        fakeStorageState.local.meetings = [
            { meetingSoftware: "Google Meet", meetingTitle: "Standup", meetingStartTimestamp: START, meetingEndTimestamp: START, transcript: [], chatMessages: [], webhookPostStatus: "successful" },
            { meetingSoftware: "", meetingTitle: "Imported", meetingStartTimestamp: "2020-01-01T00:00:00.000Z", meetingEndTimestamp: "2020-01-01T00:00:00.000Z", transcript: [], chatMessages: [], webhookPostStatus: "new" },
        ]

        const result = await newLifecycle().recover("meetings-page")
        fakeStorageState.local.meetings = []
        const afterDelete = await newLifecycle().recover("meetings-page")

        assert.deepEqual(result, { outcome: "skipped", reason: "already-finalized" })
        assert.deepEqual(afterDelete, { outcome: "skipped", reason: "already-finalized" })
        assert.equal(fakeStorageState.local.lastFinalizedMeetingStartTimestamp, START)
    })

    test("a live meeting missing from the list is recovered", async () => {
        seedLiveMeeting("hello")
        fakeStorageState.local.meetings = []

        const result = await newLifecycle().recover("meetings-page")

        assert.equal(result.outcome, "finalized")
        assert.equal(fakeStorageState.local.meetings.length, 1)
    })
})

describe("a new live meeting starting during finalization", () => {
    test("keeps its meeting tab once finalization finishes", async () => {
        seedLiveMeeting("hello")
        const lifecycle = newLifecycle()
        /** @type {() => void} */
        let release = () => {}
        afterFinalizeBehaviour = () => new Promise((resolve) => { release = () => resolve(undefined) })

        const recovering = lifecycle.recover("meeting-join")
        await new Promise((resolve) => setTimeout(resolve, 0))
        await lifecycle.meetingStarted(43)
        release()
        await recovering

        assert.equal(fakeStorageState.local.meetingTabId, 43)
    })
})
