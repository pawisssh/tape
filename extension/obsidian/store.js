// @ts-check
/// <reference path="../../types/chrome.d.ts" />
/// <reference path="../../types/index.js" />
/// <reference path="../../types/obsidian.js" />

// chrome.storage access for the Obsidian export feature. Unlike markdown.js/uri.js this
// file is stateful and chrome-dependent — not unit-testable the same way, but its tests
// (tests/store.test.mjs) install a minimal in-memory fake of chrome.storage first.

import { DEFAULT_FILENAME_TEMPLATE } from "./markdown.js"
import { DEFAULT_LLM_TIMEOUT_MS } from "./llm.js"
import { getProviders, getActiveModel } from "./providers.js"
import { INTERPRETER_SYSTEM_PROMPT } from "./interpreter.js"

const CLIPBOARD_LOCK_KEY = "obsidianClipboardLock"

// Generous enough for a human to notice the "Open Obsidian?" browser prompt and click
// Allow/Always allow before the lock is considered stale; short enough that a crashed or
// abandoned handoff tab doesn't permanently jam clipboard delivery for later meetings.
const CLIPBOARD_LOCK_TTL_MS = 15000

/**
 * Stable identifier for a Meeting record. We reuse `meetingStartTimestamp` (an ISO
 * timestamp, millisecond precision, set once by the content script when the meeting
 * starts) rather than inventing a new id field: it's already required on every Meeting,
 * it doesn't shift when a row is deleted from the `meetings` array, and a collision
 * would require two meetings starting in the same millisecond —
 * impossible here since only one meeting can be tracked at a time (see the
 * `meetingTabId: "processing"` sentinel in background-script/index.js).
 * @param {Meeting} meeting
 * @returns {string}
 */
export function getMeetingId(meeting) {
    return meeting.meetingStartTimestamp
}

/**
 * @param {string} meetingId
 * @returns {Promise<Meeting | undefined>}
 */
export function getMeetingById(meetingId) {
    return new Promise((resolve) => {
        chrome.storage.local.get(["meetings"], function (resultLocalUntyped) {
            const resultLocal = /** @type {ResultLocal} */ (resultLocalUntyped)
            const meetings = resultLocal.meetings || []
            resolve(meetings.find((m) => getMeetingId(m) === meetingId))
        })
    })
}

/**
 * Read-modify-write a single meeting record identified by its stable id. Always
 * re-reads `meetings` from storage immediately before writing (rather than trusting a
 * caller-held copy) to reduce — not eliminate — races with the other exporters
 * (download/webhook) that also read-modify-write the same array right after a meeting
 * ends. chrome.storage has no compare-and-swap primitive, so a true race where two
 * writers both read the pre-update array in the same tick is still possible; this only
 * narrows the window.
 * @param {string} meetingId
 * @param {(meeting: Meeting) => Partial<Meeting>} updater returns the fields to merge into the meeting
 * @returns {Promise<Meeting | undefined>} the updated meeting, or undefined if no meeting with this id exists
 */
export function updateMeetingById(meetingId, updater) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(["meetings"], function (resultLocalUntyped) {
            const resultLocal = /** @type {ResultLocal} */ (resultLocalUntyped)
            const meetings = resultLocal.meetings || []
            const index = meetings.findIndex((m) => getMeetingId(m) === meetingId)
            if (index === -1) {
                resolve(undefined)
                return
            }
            const updated = { ...meetings[index], ...updater(meetings[index]) }
            meetings[index] = updated
            chrome.storage.local.set({ meetings }, function () {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError)
                    return
                }
                resolve(updated)
            })
        })
    })
}

/**
 * @returns {Promise<{endpoint: string, model: string, apiKey: string | undefined}>}
 */
function resolveActiveLlmConnection() {
    return Promise.all([getProviders(), getActiveModel()]).then(([providers, activeModel]) => {
        const provider = activeModel ? providers.find((p) => p.id === activeModel.providerId) : undefined
        if (!provider || !activeModel) {
            return { endpoint: "", model: "", apiKey: undefined }
        }
        return {
            endpoint: `${provider.baseUrl}/chat/completions`,
            model: activeModel.modelId,
            apiKey: provider.apiKey || undefined,
        }
    })
}

/**
 * @returns {Promise<ObsidianSettings>}
 */
export function getObsidianSettings() {
    return Promise.all([
        new Promise((resolve) => {
            chrome.storage.sync.get([
                "obsidianVaultName",
                "obsidianFolder",
                "obsidianFileNameTemplate",
                "obsidianUseLlm",
                "obsidianLlmTimeoutMs",
                "obsidianLlmAutoRun",
                "obsidianLlmSummaryTemplates",
                "obsidianLlmSystemPrompt",
            ], function (resultSyncUntyped) {
                resolve(/** @type {ResultSync} */ (resultSyncUntyped))
            })
        }),
        resolveActiveLlmConnection(),
    ]).then(([resultSync, connection]) => ({
        // No separate toggle — auto-save turns on the moment a vault name is configured
        // (folder/filename template both have working defaults, so vault name is the
        // only thing that actually needs to be "correct" for a handoff to make sense).
        autoSaveToObsidianAfterMeeting: !!resultSync.obsidianVaultName,
        obsidianVaultName: resultSync.obsidianVaultName || "",
        obsidianFolder: resultSync.obsidianFolder || "",
        obsidianFileNameTemplate: resultSync.obsidianFileNameTemplate || DEFAULT_FILENAME_TEMPLATE,
        obsidianUseLlm: resultSync.obsidianUseLlm === true,
        obsidianLlmEndpoint: connection.endpoint,
        obsidianLlmModel: connection.model,
        obsidianLlmApiKey: connection.apiKey,
        obsidianLlmAutoRun: resultSync.obsidianLlmAutoRun !== false,
        obsidianLlmSummaryTemplates: resultSync.obsidianLlmSummaryTemplates || [],
        obsidianLlmTimeoutMs: resultSync.obsidianLlmTimeoutMs || DEFAULT_LLM_TIMEOUT_MS,
        obsidianLlmSystemPrompt: resultSync.obsidianLlmSystemPrompt || INTERPRETER_SYSTEM_PROMPT,
    }))
}

/**
 * @param {Partial<ObsidianSettings>} settings
 * @returns {Promise<void>}
 */
export function setObsidianSettings(settings) {
    return new Promise((resolve, reject) => {
        chrome.storage.sync.set(settings, function () {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError)
                return
            }
            resolve(undefined)
        })
    })
}

/**
 * Best-effort lock to reduce the chance of two concurrent handoffs both writing to the
 * OS clipboard for an oversized note at the same time (e.g. an auto-handoff and a manual
 * "Save to Obsidian" retry landing within the same few seconds). This does NOT fully
 * eliminate the race: chrome.storage.local has no compare-and-swap, so this is a plain
 * read-then-write — if two callers both read "unlocked" before either has written the
 * lock back, both will proceed. The TTL bounds how long a crashed handoff can hold the
 * lock, at the cost of allowing exactly that race to recur after the TTL expires. This is
 * documented as a known limitation, not claimed as full correctness.
 * @returns {Promise<boolean>} true if the lock was acquired
 */
export function acquireClipboardLock() {
    return new Promise((resolve) => {
        chrome.storage.local.get([CLIPBOARD_LOCK_KEY], function (resultUntyped) {
            const result = /** @type {Object<string, { acquiredAt: number }>} */ (resultUntyped)
            const existing = result[CLIPBOARD_LOCK_KEY]
            const now = Date.now()
            if (existing && (now - existing.acquiredAt) < CLIPBOARD_LOCK_TTL_MS) {
                resolve(false)
                return
            }
            chrome.storage.local.set({ [CLIPBOARD_LOCK_KEY]: { acquiredAt: now } }, function () {
                resolve(true)
            })
        })
    })
}

/**
 * @returns {Promise<void>}
 */
export function releaseClipboardLock() {
    return new Promise((resolve) => {
        chrome.storage.local.remove([CLIPBOARD_LOCK_KEY], function () {
            resolve(undefined)
        })
    })
}
