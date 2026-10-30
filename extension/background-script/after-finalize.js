import { downloadTranscript, postTranscriptToWebhook } from './exporters.js'
import { getObsidianSettings, updateMeetingById, getMeetingId } from '../obsidian/store.js'

/**
 * The production after-finalize effect handed to createMeetingLifecycle() (meetings.js):
 * downloads the just-finalized Meeting and posts it to the webhook if those are enabled,
 * then — only once both succeed — fires off the Obsidian handoff. Runs after the Meeting is
 * already saved and marked finalized, so a failure here never causes it to be finalized
 * again; the user retries from the Meetings page instead.
 * @param {Meeting} meeting
 * @returns {Promise<void>} rejects with an ErrorObject (009, 010, 011, 012)
 */
export function exportFinalizedMeeting(meeting) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(["meetings"], function (resultLocalUntyped) {
            const resultLocal = /** @type {ResultLocal} */ (resultLocalUntyped)
            chrome.storage.sync.get(["webhookUrl", "autoPostWebhookAfterMeeting", "autoDownloadFileAfterMeeting"], function (resultSyncUntyped) {
                const resultSync = /** @type {ResultSync} */ (resultSyncUntyped)

                // The exporters address Meetings by index; find this one's, newest first.
                const meetings = resultLocal.meetings || []
                let index = -1
                for (let i = meetings.length - 1; i >= 0; i--) {
                    if (meetings[i].meetingStartTimestamp === meeting.meetingStartTimestamp) {
                        index = i
                        break
                    }
                }
                if (index === -1) {
                    reject({ errorCode: "017", errorMessage: "Meeting not found — it may have been deleted from history." })
                    return
                }

                /** @type {Promise<any>[]} */
                const promises = []
                if (resultSync.autoDownloadFileAfterMeeting) {
                    promises.push(downloadTranscript(index))
                }
                if (resultSync.autoPostWebhookAfterMeeting && resultSync.webhookUrl) {
                    promises.push(postTranscriptToWebhook(index))
                }

                Promise.all(promises)
                    .then(() => {
                        resolve()

                        // Fire-and-forget: must never block or fail the download/webhook
                        // exporters above — any error here is only logged.
                        triggerObsidianHandoffIfConfigured(meeting).catch((error) => {
                            console.error("Obsidian handoff trigger failed (non-fatal):", error)
                        })
                    })
                    .catch((error) => {
                        // Fails with error codes: 009, 010, 011, 012
                        const parsedError = /** @type {ErrorObject} */ (error)
                        console.error("Operation failed:", parsedError.errorMessage)
                        reject({ errorCode: parsedError.errorCode, errorMessage: parsedError.errorMessage })
                    })
            })
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
