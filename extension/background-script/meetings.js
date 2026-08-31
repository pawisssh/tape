import { downloadTranscript, postTranscriptToWebhook } from './exporters.js'
import { getObsidianSettings, updateMeetingById, getMeetingId } from '../obsidian/store.js'

// Two independent listeners in index.js can both observe the same meeting ending — the
// "meeting_ended" message (sent when the user clicks the platform's own end-call button)
// and chrome.tabs.onRemoved (fired when the meeting tab actually closes, a very plausible
// near-immediate follow-on to that click). Both used to do their own check-then-act on the
// meetingTabId storage key before calling processLastMeeting() — separate async
// chrome.storage round-trips with no atomicity, so both could read the pre-"processing"
// value and both call processLastMeeting() concurrently, double-pushing the same meeting
// into the meetings array (pickupLastMeetingFromStorage() below reads the same live
// transcript/chatMessages keys either caller could still see) and double-triggering
// downloads/webhook posts/the Obsidian handoff. See PLAN.md §7.1.
//
// The fix is a synchronous in-memory guard, not a storage-based lock: Chrome delivers
// extension events one at a time to a single JS execution context per service-worker
// instance — there's no true parallelism, only interleaved async callbacks — so a
// module-level flag, set as the very first synchronous action before either listener
// touches chrome.storage, is sufficient to fully close this race. No timeout/TTL needed,
// unlike extension/obsidian/store.js's clipboard lock (which guards overlapping *user
// actions* across separate page loads, a genuinely different problem).
let finalizationInFlight = false

/**
 * Runs `runProcessLastMeeting` (production callers pass processLastMeeting itself) at most
 * once per meeting-end event, even though two independent listeners can both try. Takes
 * the function to run as a parameter, rather than importing processLastMeeting directly,
 * so this guard stays unit-testable without needing to import all of index.js (which
 * registers chrome.runtime.onMessage/chrome.tabs.onRemoved/chrome.alarms/chrome.permissions
 * listeners at module load time). Never rejects — callers branch on the returned shape
 * instead of try/catch, matching this codebase's "resolve to a distinct shape rather than
 * throw" style (see extension/obsidian/llm.js).
 * @param {() => Promise<any>} runProcessLastMeeting
 * @returns {Promise<{ranMeetingFinalization: false} | {ranMeetingFinalization: true, result: any} | {ranMeetingFinalization: true, error: any}>}
 */
export function finalizeMeetingOnce(runProcessLastMeeting) {
    if (finalizationInFlight) {
        // Another listener already claimed this meeting-end event — a safe no-op, not an
        // error, so the loser can still respond to its own caller (e.g. sendResponse for
        // the "meeting_ended" message) without duplicating the actual finalization work.
        return Promise.resolve(/** @type {{ranMeetingFinalization: false}} */ ({ ranMeetingFinalization: false }))
    }
    finalizationInFlight = true
    return runProcessLastMeeting()
        .then((result) => /** @type {{ranMeetingFinalization: true, result: any}} */ ({ ranMeetingFinalization: true, result }))
        .catch((error) => /** @type {{ranMeetingFinalization: true, error: any}} */ ({ ranMeetingFinalization: true, error }))
        .finally(() => {
            finalizationInFlight = false
        })
}

// Download transcripts, post webhook if URL is enabled and available
// Fails if transcript is empty or webhook request fails or if no meetings in storage
/** @throws error codes: 009, 010, 011, 012, 013, 014 */
export function processLastMeeting() {
    return new Promise((resolve, reject) => {
        pickupLastMeetingFromStorage()
            .then(() => {
                chrome.storage.local.get(["meetings"], function (resultLocalUntyped) {
                    const resultLocal = /** @type {ResultLocal} */ (resultLocalUntyped)
                    chrome.storage.sync.get(["webhookUrl", "autoPostWebhookAfterMeeting", "autoDownloadFileAfterMeeting"], function (resultSyncUntyped) {
                        const resultSync = /** @type {ResultSync} */ (resultSyncUntyped)

                        // Create an array of promises to execute in parallel
                        /** @type {Promise<any>[]} */
                        const promises = []

                        // Meeting index to download and post webhook
                        // @ts-ignore - Because this line exists in the resolved promise from pickupLastMeetingFromStorage, which clearly means that at least one meeting exists and resultLocal.meetings cannot be undefined.
                        const lastIndex = resultLocal.meetings.length - 1

                        // Promise to download transcript
                        if (resultSync.autoDownloadFileAfterMeeting) {
                            promises.push(
                                downloadTranscript(lastIndex)
                            )
                        }

                        // Promise to post webhook if enabled
                        if (resultSync.autoPostWebhookAfterMeeting && resultSync.webhookUrl) {
                            promises.push(postTranscriptToWebhook(lastIndex))
                        }

                        // Execute all promises in parallel
                        Promise.all(promises)
                            .then(() => {
                                resolve("Meeting processing and download/webhook posting complete")

                                // Fire-and-forget: hand off to Obsidian if auto-save is configured.
                                // Must never block or fail the download/webhook exporters above —
                                // this promise's resolve() has already been called by this point,
                                // and any error here is only logged, never propagated to the caller.
                                // @ts-ignore - Because this line exists in the resolved promise from pickupLastMeetingFromStorage, which clearly means that at least one meeting exists and resultLocal.meetings cannot be undefined.
                                const lastMeeting = resultLocal.meetings[lastIndex]
                                triggerObsidianHandoffIfConfigured(lastMeeting).catch((error) => {
                                    console.error("Obsidian handoff trigger failed (non-fatal):", error)
                                })
                            })
                            .catch(error => {
                                // Fails with error codes: 009, 010, 011, 012
                                const parsedError = /** @type {ErrorObject} */ (error)
                                console.error("Operation failed:", parsedError.errorMessage)
                                reject({ errorCode: parsedError.errorCode, errorMessage: parsedError.errorMessage })
                            })
                    })
                })
            })
            .catch((error) => {
                // Fails with error codes: 013, 014
                const parsedError = /** @type {ErrorObject} */ (error)
                reject({ errorCode: parsedError.errorCode, errorMessage: parsedError.errorMessage })
            })
    })
}

/**
 * @throws error codes: 013, 014
 */
// Process transcript and chat messages of the meeting that just ended from storage, format them into strings, and save as a new entry in meetings
export function pickupLastMeetingFromStorage() {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get([
            "meetingSoftware",
            "meetingTitle",
            "meetingStartTimestamp",
            "transcript",
            "chatMessages",
        ], function (resultUntyped) {
            const result = /** @type {ResultLocal} */ (resultUntyped)

            if (result.meetingStartTimestamp) {
                if ((result.transcript.length > 0) || (result.chatMessages.length > 0)) {
                    // Create new transcript entry
                    /** @type {Meeting} */
                    const newMeetingEntry = {
                        meetingSoftware: result.meetingSoftware ? result.meetingSoftware : "",
                        meetingTitle: result.meetingTitle,
                        meetingStartTimestamp: result.meetingStartTimestamp,
                        meetingEndTimestamp: new Date().toISOString(),
                        transcript: result.transcript,
                        chatMessages: result.chatMessages,
                        webhookPostStatus: "new"
                    }

                    // Get existing recent meetings and add the new meeting
                    chrome.storage.local.get(["meetings"], function (resultLocalUntyped) {
                        const resultLocal = /** @type {ResultLocal} */ (resultLocalUntyped)
                        let meetings = resultLocal.meetings || []
                        meetings.push(newMeetingEntry)

                        // Save updated meetings — kept unbounded (see manifest's
                        // "unlimitedStorage" permission, which exempts chrome.storage.local
                        // from its default 5MB quota so this never needs trimming).
                        chrome.storage.local.set({ meetings: meetings }, function () {
                            console.log("Last meeting picked up")
                            resolve("Last meeting picked up")
                        })
                    })
                }
                else {
                    reject({ errorCode: "014", errorMessage: "Empty transcript and empty chatMessages" })
                }
            }
            else {
                reject({ errorCode: "013", errorMessage: "No meetings found. May be attend one?" })
            }
        })
    })
}


/** @throws error codes: 009, 010, 011, 012, 013, 014 */
export function recoverLastMeeting() {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(["meetings", "meetingStartTimestamp", "meetingTabId"], function (resultLocalUntyped) {
            const resultLocal = /** @type {ResultLocal} */ (resultLocalUntyped)

            function checkIfRecoveryNeeded() {
                // Check if user ever attended a meeting
                if (resultLocal.meetingStartTimestamp) {
                    /** @type {Meeting | undefined} */
                    let lastSavedMeeting
                    if ((resultLocal.meetings) && (resultLocal.meetings.length > 0)) {
                        lastSavedMeeting = resultLocal.meetings[resultLocal.meetings.length - 1]
                    }

                    // Last meeting was not processed for some reason. Need to recover that data, process and download it.
                    if ((!lastSavedMeeting) || (resultLocal.meetingStartTimestamp !== lastSavedMeeting.meetingStartTimestamp)) {
                        processLastMeeting().then(() => {
                            resolve("Recovered last meeting to the best possible extent")
                        }).catch((error) => {
                            // Fails with error codes: 009, 010, 011, 013, 014
                            const parsedError = /** @type {ErrorObject} */ (error)
                            reject({ errorCode: parsedError.errorCode, errorMessage: parsedError.errorMessage })
                        })
                    }
                    else {
                        resolve("No recovery needed")
                    }
                }
                else {
                    reject({ errorCode: "013", errorMessage: "No meetings found. May be attend one?" })
                }
            }

            // Guard against force-ending a meeting that's still genuinely being captured.
            // This function is called both on browser startup (crash recovery — any stored
            // meetingTabId is guaranteed stale there, since tabs get new ids after a full
            // restart) and every time the Meetings page mounts (MeetingsView.tsx) — the
            // latter previously had no way to tell "capture is still live" from "capture
            // wasn't properly finalized", and would force-finalize (i.e. end) an actively
            // recording meeting just from being opened. meetingTabId is the extension's
            // single source of truth for "is a meeting being captured right now" (see
            // src/meetings/use-live-capture-state.ts) — checking it here, including
            // verifying the tab is actually still open, fixes that without touching the
            // crash-recovery path (a stale id there always fails the tabs.get check below).
            if (resultLocal.meetingTabId === "processing") {
                resolve("No recovery needed — a meeting is already being processed")
            }
            else if (typeof resultLocal.meetingTabId === "number") {
                chrome.tabs.get(resultLocal.meetingTabId, () => {
                    if (chrome.runtime.lastError) {
                        // Tab no longer exists — stale id, safe to run the normal recovery check.
                        checkIfRecoveryNeeded()
                    }
                    else {
                        resolve("No recovery needed — a meeting is actively being captured")
                    }
                })
            }
            else {
                checkIfRecoveryNeeded()
            }
        })
    })
}

/**
 * Opens the Obsidian handoff page (extension/obsidian/handoff.html) for a meeting that
 * just ended, if `autoSaveToObsidianAfterMeeting` is on. Fire-and-forget from the
 * caller's perspective — this must never be awaited in a way that blocks or fails the
 * existing download/webhook exporters, since the handoff page may perform a slow local
 * LLM call (Phase 4) and Obsidian may not even be installed.
 *
 * This is now the ONLY way a handoff tab gets opened — a manual "Save to Obsidian" click
 * on the Meetings page runs the same underlying flow in place instead (see
 * extension/obsidian/save-flow.js, called directly from src/meetings/agenda/
 * MeetingDetail.tsx), since a Meetings page tab is already open and focused at that
 * point and doesn't need a disposable tab of its own.
 * @param {Meeting} meeting
 * @returns {Promise<{ opened: boolean }>}
 */
export function triggerObsidianHandoffIfConfigured(meeting) {
    return getObsidianSettings().then((settings) => {
        if (!settings.autoSaveToObsidianAfterMeeting) {
            return { opened: false }
        }

        const meetingId = getMeetingId(meeting)
        return updateMeetingById(meetingId, () => ({ obsidianSaveStatus: "pending" }))
            .then(() => {
                // Phase 5 note: the built dist/ output mirrors extension/obsidian/handoff.html's
                // own repo-relative source path (Vite mirrors the input file's path, not an
                // arbitrary Rollup input key — see vite.config.ts) — so this getURL() path carries
                // the "extension/" prefix to match, unlike pre-Phase-5 where the unpacked root was
                // extension/ itself and no prefix was needed.
                chrome.tabs.create({
                    url: chrome.runtime.getURL(`extension/obsidian/handoff.html?meetingId=${encodeURIComponent(meetingId)}`)
                })
                return { opened: true }
            })
    })
}

