import { getTranscriptString, getChatMessagesString } from './utils.js'
import { TIMEFORMAT } from './config.js'
import { buildFilename, resolveFilenameTemplate } from '../obsidian/markdown.js'
import { cleanFileTitle } from '../obsidian/file-title.js'
import { writeToSaveFolder } from './save-folder.js'

/**
 * Saves to the folder picked in Settings, or to Downloads/Tape when none is picked or it
 * can't be written right now: a transcript is never lost to a lapsed permission.
 * @param {Meeting} meeting
 * @param {string} content
 * @returns {Promise<string>}
 */
async function saveTranscriptFile(meeting, content) {
    const { obsidianFileNameTemplate } = await chrome.storage.sync.get(["obsidianFileNameTemplate"])
    const filename = buildFilename(resolveFilenameTemplate(/** @type {string | undefined} */ (obsidianFileNameTemplate)), meeting, {
        aiTitle: cleanFileTitle(meeting.llmSummaryTitle),
    })

    const outcome = await writeToSaveFolder(filename, content)
    if (outcome === "saved") {
        return "Transcript saved to the chosen folder"
    }

    const url = `data:text/markdown;charset=utf-8,${encodeURIComponent(content)}`
    try {
        await chrome.downloads.download({ url, filename: `Tape/${filename}`, conflictAction: "uniquify" })
    } catch (err) {
        console.error(err)
        await chrome.downloads.download({ url, filename: "Tape/Transcript.md", conflictAction: "uniquify" })
    }
    return outcome === "unavailable"
        ? "Saved to Downloads/Tape: the chosen folder needs access again (Settings → Files)"
        : "Transcript downloaded successfully"
}

/**
 * @param {number} index
 * @param {boolean} [isWebhookEnabled]
 * @throws error codes: 009, 010
 */
export function downloadTranscript(index, isWebhookEnabled) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(["meetings"], function (resultLocalUntyped) {
            const resultLocal = /** @type {ResultLocal} */ (resultLocalUntyped)

            if (resultLocal.meetings && resultLocal.meetings[index]) {
                const meeting = resultLocal.meetings[index]

                // Format transcript and chatMessages content
                let content = getTranscriptString(meeting.transcript)
                if (meeting.chatMessages && meeting.chatMessages.length > 0) {
                    content += `\n\n---------------\nCHAT MESSAGES\n---------------\n\n`
                    content += getChatMessagesString(meeting.chatMessages)
                }

                saveTranscriptFile(meeting, content).then(resolve, (err) => {
                    console.error(err)
                    reject({ errorCode: "009", errorMessage: "Failed to save transcript file" })
                })
            }
            else {
                reject({ errorCode: "010", errorMessage: "Meeting at specified index not found" })
            }
        })
    })
}

/**
 * @param {number} index
 * @throws error code: 010, 011, 012
 */
export function postTranscriptToWebhook(index) {
    return new Promise((resolve, reject) => {
        // Get webhook URL and meetings
        chrome.storage.local.get(["meetings"], function (resultLocalUntyped) {
            const resultLocal = /** @type {ResultLocal} */ (resultLocalUntyped)
            chrome.storage.sync.get(["webhookUrl", "webhookBodyType"], function (resultSyncUntyped) {
                const resultSync = /** @type {ResultSync} */ (resultSyncUntyped)

                if (resultSync.webhookUrl) {
                    if (resultLocal.meetings && resultLocal.meetings[index]) {
                        const meeting = resultLocal.meetings[index]

                        /** @type {WebhookBody} */
                        let webhookData
                        if (resultSync.webhookBodyType === "advanced") {
                            webhookData = {
                                webhookBodyType: "advanced",
                                meetingSoftware: meeting.meetingSoftware ? meeting.meetingSoftware : "",
                                meetingTitle: meeting.meetingTitle || meeting.title || "",
                                meetingStartTimestamp: new Date(meeting.meetingStartTimestamp).toISOString(),
                                meetingEndTimestamp: new Date(meeting.meetingEndTimestamp).toISOString(),
                                transcript: meeting.transcript,
                                chatMessages: meeting.chatMessages
                            }
                        }
                        else {
                            webhookData = {
                                webhookBodyType: "simple",
                                meetingSoftware: meeting.meetingSoftware ? meeting.meetingSoftware : "",
                                meetingTitle: meeting.meetingTitle || meeting.title || "",
                                meetingStartTimestamp: new Date(meeting.meetingStartTimestamp).toLocaleString("default", TIMEFORMAT).toUpperCase(),
                                meetingEndTimestamp: new Date(meeting.meetingEndTimestamp).toLocaleString("default", TIMEFORMAT).toUpperCase(),
                                transcript: getTranscriptString(meeting.transcript),
                                chatMessages: getChatMessagesString(meeting.chatMessages)
                            }
                        }

                        // Post to webhook
                        fetch(resultSync.webhookUrl, {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json"
                            },
                            body: JSON.stringify(webhookData)
                        }).then(response => {
                            if (!response.ok) {
                                throw new Error(`Webhook request failed with HTTP status code ${response.status} ${response.statusText}`)
                            }
                        }).then(() => {
                            // Update success status.
                            // @ts-ignore - Pointless type error about resultLocal.meetings being undefined, which is already checked above.
                            resultLocal.meetings[index].webhookPostStatus = "successful"
                            chrome.storage.local.set({ meetings: resultLocal.meetings }, function () {
                                resolve("Webhook posted successfully")
                            })
                        }).catch(error => {
                            console.error(error)
                            // Update failure status.
                            // @ts-ignore - Pointless type error about resultLocal.meetings being undefined, which is already checked above.
                            resultLocal.meetings[index].webhookPostStatus = "failed"
                            chrome.storage.local.set({ meetings: resultLocal.meetings }, function () {
                                // Create notification and open webhooks page
                                chrome.notifications.create({
                                    type: "basic",
                                    iconUrl: "icon.png",
                                    title: "Could not post webhook!",
                                    message: "Click to view status and retry. Check console for more details."
                                }, function (notificationId) {
                                    // Handle notification click
                                    chrome.notifications.onClicked.addListener(function (clickedNotificationId) {
                                        if (clickedNotificationId === notificationId) {
                                            chrome.tabs.create({ url: "meetings.html" })
                                        }
                                    })
                                })
                                reject({ errorCode: "011", errorMessage: error })
                            })
                        })
                    }
                    else {
                        reject({ errorCode: "010", errorMessage: "Meeting at specified index not found" })
                    }
                }
                else {
                    reject({ errorCode: "012", errorMessage: "No webhook URL configured" })
                }
            })
        })
    })
}