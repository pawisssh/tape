import { test, describe, beforeEach } from "node:test"
import assert from "node:assert/strict"

// Minimal in-memory fake of the chrome.storage APIs store.js depends on. Installed on
// globalThis before importing store.js, since store.js reads `chrome.*` lazily inside
// function bodies (not at module-evaluation time), so import order doesn't matter here.
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
            remove(keys, callback) {
                const list = Array.isArray(keys) ? keys : [keys]
                for (const k of list) delete fakeStorageState[areaName][k]
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

const {
    getMeetingId,
    getMeetingById,
    updateMeetingById,
    getObsidianSettings,
    setObsidianSettings,
    acquireClipboardLock,
    releaseClipboardLock,
} = await import("../extension/obsidian/store.js")
const { DEFAULT_FILENAME_TEMPLATE } = await import("../extension/obsidian/markdown.js")

beforeEach(() => {
    installFakeChrome()
})

function makeMeeting(overrides = {}) {
    return {
        meetingSoftware: "Google Meet",
        meetingTitle: "Standup",
        meetingStartTimestamp: "2026-08-26T10:00:00.000Z",
        meetingEndTimestamp: "2026-08-26T10:15:00.000Z",
        transcript: [],
        chatMessages: [],
        webhookPostStatus: "new",
        ...overrides,
    }
}

describe("getMeetingId", () => {
    test("uses meetingStartTimestamp as the stable id", () => {
        const meeting = makeMeeting()
        assert.equal(getMeetingId(meeting), meeting.meetingStartTimestamp)
    })
})

describe("getMeetingById / updateMeetingById", () => {
    test("finds a meeting by id regardless of array position", async () => {
        const a = makeMeeting({ meetingStartTimestamp: "2026-08-26T09:00:00.000Z" })
        const b = makeMeeting({ meetingStartTimestamp: "2026-08-26T10:00:00.000Z" })
        fakeStorageState.local.meetings = [a, b]

        const found = await getMeetingById(getMeetingId(b))
        assert.deepEqual(found, b)
    })

    test("returns undefined for an unknown id", async () => {
        fakeStorageState.local.meetings = [makeMeeting()]
        const found = await getMeetingById("does-not-exist")
        assert.equal(found, undefined)
    })

    test("updateMeetingById does a read-modify-write and only touches the target meeting", async () => {
        const a = makeMeeting({ meetingStartTimestamp: "2026-08-26T09:00:00.000Z" })
        const b = makeMeeting({ meetingStartTimestamp: "2026-08-26T10:00:00.000Z" })
        fakeStorageState.local.meetings = [a, b]

        const updated = await updateMeetingById(getMeetingId(b), () => ({ obsidianSaveStatus: "handed_off" }))
        assert.equal(updated.obsidianSaveStatus, "handed_off")

        const stored = fakeStorageState.local.meetings
        assert.equal(stored[0].obsidianSaveStatus, undefined)
        assert.equal(stored[1].obsidianSaveStatus, "handed_off")
    })

    test("updateMeetingById resolves undefined when the meeting no longer exists", async () => {
        fakeStorageState.local.meetings = []
        const result = await updateMeetingById("nope", () => ({ obsidianSaveStatus: "failed" }))
        assert.equal(result, undefined)
    })
})

describe("getObsidianSettings / setObsidianSettings", () => {
    test("returns defaults when nothing has been saved", async () => {
        const settings = await getObsidianSettings()
        assert.equal(settings.autoSaveToObsidianAfterMeeting, false)
        assert.equal(settings.obsidianVaultName, "")
        assert.equal(settings.obsidianFolder, "")
        assert.equal(settings.obsidianFileNameTemplate, DEFAULT_FILENAME_TEMPLATE)
        assert.equal(settings.obsidianUseLlm, false)
        // No provider/model configured yet — resolves to empty, not a hardcoded default
        // server. See "resolves the active provider" below for the configured case.
        assert.equal(settings.obsidianLlmEndpoint, "")
        assert.equal(settings.obsidianLlmModel, "")
        assert.equal(settings.obsidianLlmApiKey, undefined)
        assert.equal(settings.obsidianLlmTimeoutMs, 600000)
        assert.deepEqual(settings.obsidianLlmSummaryTemplates, [])
        assert.equal(settings.outputLanguage, "auto")
    })

    test("reads the AI output language, falling back to auto for unknown values", async () => {
        await setObsidianSettings(/** @type {any} */ ({ outputLanguage: "th" }))
        assert.equal((await getObsidianSettings()).outputLanguage, "th")
        await setObsidianSettings(/** @type {any} */ ({ outputLanguage: "fr" }))
        assert.equal((await getObsidianSettings()).outputLanguage, "auto")
    })

    test("round-trips saved sync-only settings", async () => {
        await setObsidianSettings({
            obsidianVaultName: "My Vault",
            obsidianFolder: "Meetings",
            obsidianFileNameTemplate: "{{title}}",
            obsidianUseLlm: true,
            obsidianLlmTimeoutMs: 30000,
        })
        const settings = await getObsidianSettings()
        assert.equal(settings.autoSaveToObsidianAfterMeeting, true)
        assert.equal(settings.obsidianVaultName, "My Vault")
        assert.equal(settings.obsidianFolder, "Meetings")
        assert.equal(settings.obsidianFileNameTemplate, "{{title}}")
        assert.equal(settings.obsidianUseLlm, true)
        assert.equal(settings.obsidianLlmTimeoutMs, 30000)
    })

    test("autoSaveToObsidianAfterMeeting has no toggle of its own — it tracks whether a vault name is set", async () => {
        assert.equal((await getObsidianSettings()).autoSaveToObsidianAfterMeeting, false)

        await setObsidianSettings({ obsidianVaultName: "My Vault" })
        assert.equal((await getObsidianSettings()).autoSaveToObsidianAfterMeeting, true)

        await setObsidianSettings({ obsidianVaultName: "" })
        assert.equal((await getObsidianSettings()).autoSaveToObsidianAfterMeeting, false)
    })

    test("resolves obsidianLlmEndpoint/Model/ApiKey from the saved provider + active model", async () => {
        fakeStorageState.local.obsidianLlmProviders = [
            { id: "p1", type: "ollama", name: "Ollama", baseUrl: "http://localhost:11434/v1" },
            { id: "p2", type: "custom", name: "OpenAI", baseUrl: "https://api.openai.com/v1", apiKey: "sk-test" },
        ]
        fakeStorageState.local.obsidianLlmActiveModel = { providerId: "p2", modelId: "gpt-4o-mini" }

        const settings = await getObsidianSettings()
        assert.equal(settings.obsidianLlmEndpoint, "https://api.openai.com/v1/chat/completions")
        assert.equal(settings.obsidianLlmModel, "gpt-4o-mini")
        assert.equal(settings.obsidianLlmApiKey, "sk-test")
    })

    test("resolves to empty when the active model points at a provider that no longer exists", async () => {
        fakeStorageState.local.obsidianLlmProviders = []
        fakeStorageState.local.obsidianLlmActiveModel = { providerId: "gone", modelId: "whatever" }

        const settings = await getObsidianSettings()
        assert.equal(settings.obsidianLlmEndpoint, "")
        assert.equal(settings.obsidianLlmModel, "")
        assert.equal(settings.obsidianLlmApiKey, undefined)
    })
})

describe("clipboard lock", () => {
    test("a second acquire fails while the first lock is held", async () => {
        const first = await acquireClipboardLock()
        assert.equal(first, true)

        const second = await acquireClipboardLock()
        assert.equal(second, false, "concurrent acquire should be rejected — this is the race the lock DOES prevent")
    })

    test("releasing the lock allows a subsequent acquire to succeed", async () => {
        await acquireClipboardLock()
        await releaseClipboardLock()

        const reacquired = await acquireClipboardLock()
        assert.equal(reacquired, true)
    })

    // Documents the race the lock does NOT eliminate: chrome.storage.local has no
    // compare-and-swap, so two callers reading "unlocked" before either has written the
    // lock back can both proceed. This is a read-then-write race we accept per store.js's
    // documented limitation, not something this test can meaningfully assert against with
    // an in-memory fake that processes get()/set() sequentially — recorded here only as
    // documentation of the known gap, not as a regression test.
})
