import { downloadTranscript, postTranscriptToWebhook } from './exporters.js'
import { getObsidianSettings, updateMeetingById, getMeetingId } from '../obsidian/store.js'

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
                                triggerObsidianHandoffIfConfigured(lastMeeting, true).catch((error) => {
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
// Process transcript and chat messages of the meeting that just ended from storage, format them into strings, and save as a new entry in meetings (keeping last 10)
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

                        // Keep only last 10 transcripts
                        if (meetings.length > 10) {
                            meetings = meetings.slice(-10)
                        }

                        // Save updated recent transcripts
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
        chrome.storage.local.get(["meetings", "meetingStartTimestamp"], function (resultLocalUntyped) {
            const resultLocal = /** @type {ResultLocal} */ (resultLocalUntyped)
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
        })
    })
}

/**
 * Opens the Obsidian handoff page (extension/obsidian/handoff.html) for a meeting.
 * Fire-and-forget from the caller's perspective — this must never be awaited in a way
 * that blocks or fails the existing download/webhook exporters, since the handoff page
 * may perform a slow local LLM call (Phase 4) and Obsidian may not even be installed.
 *
 * When `auto` is true (called right after a meeting ends), the handoff only opens if
 * `autoSaveToObsidianAfterMeeting` is on. When `auto` is false (a manual "Save to
 * Obsidian" click from the history page), it opens whenever a vault name is configured,
 * regardless of the auto-save toggle.
 * @param {Meeting} meeting
 * @param {boolean} auto
 * @returns {Promise<{ opened: boolean, reason?: "obsidian_not_configured" | "auto_save_disabled" }>}
 */
export function triggerObsidianHandoffIfConfigured(meeting, auto) {
    return getObsidianSettings().then((settings) => {
        if (!settings.obsidianVaultName) {
            return { opened: false, reason: /** @type {const} */ ("obsidian_not_configured") }
        }
        if (auto && !settings.autoSaveToObsidianAfterMeeting) {
            return { opened: false, reason: /** @type {const} */ ("auto_save_disabled") }
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
                    url: chrome.runtime.getURL(`extension/obsidian/handoff.html?meetingId=${encodeURIComponent(meetingId)}&auto=${auto}`)
                })
                return { opened: true }
            })
    })
}

