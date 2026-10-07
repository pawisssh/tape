import { ALARM_NAME, INTERVAL_IN_MINUTES, TIMEFORMAT } from "./config.js"
import { getPermissionStatus } from "./platforms.js"


export function checkAndCreateAlarm() {
    chrome.alarms.get(ALARM_NAME, (alarm) => {
        if (!alarm) {
            chrome.alarms.create(ALARM_NAME, {
                periodInMinutes: INTERVAL_IN_MINUTES
            })
            console.log(`Alarm "${ALARM_NAME}" created successfully.`)
        } else {
            console.log(`Alarm "${ALARM_NAME}" already exists. Next scheduled run:`, new Date(alarm.scheduledTime))
        }
    })
}

/**
 * Format transcript entries into string
 * @param {TranscriptBlock[]} transcript
 */
export function getTranscriptString(transcript) {
    let transcriptString = ""
    if (transcript.length > 0) {
        transcript.forEach(transcriptBlock => {
            transcriptString += `${transcriptBlock.personName} (${new Date(transcriptBlock.timestamp).toLocaleString("default", TIMEFORMAT).toUpperCase()})\n`
            transcriptString += transcriptBlock.transcriptText
            transcriptString += "\n\n"
        })
        return transcriptString
    }
    return transcriptString
}

/**
 * Formats the live comment notes captured mid-meeting from the floating widget's Note
 * tab (see extension/content-scripts/live-panel.js) into the same plain
 * text shape as Meeting.userNotes, one timestamp header + text per note, so the result can
 * be dropped straight into a fresh meeting's userNotes with no further transformation (see
 * pickupLastMeetingFromStorage() in meetings.js). Pure — never mutates `liveCommentNotes`.
 * @param {CommentNoteEntry[] | undefined} liveCommentNotes
 */
export function formatCommentNotesAsUserNotes(liveCommentNotes) {
    let notesString = ""
    if (liveCommentNotes && liveCommentNotes.length > 0) {
        liveCommentNotes.forEach(note => {
            notesString += `${new Date(note.timestamp).toLocaleString("default", TIMEFORMAT).toUpperCase()}\n`
            if (note.linkedTranscript?.transcriptText) {
                const speech = note.linkedTranscript
                const time = Number.isFinite(Date.parse(speech.timestamp))
                    ? new Date(speech.timestamp).toLocaleTimeString("default", TIMEFORMAT)
                    : ""
                notesString += `Linked to ${speech.personName}${time ? ` · ${time}` : ""}: ${speech.transcriptText}\n`
            }
            notesString += note.text
            notesString += "\n\n"
        })
    }
    return notesString
}

/**
 * Escapes regex-special characters so a word can be matched literally.
 * @param {string} text
 */
function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Runs a user's Dictionary (extension/obsidian/dictionary.js) over a transcript, fixing
 * commonly mis-transcribed words/names/jargon before the meeting is finalized (see
 * pickupLastMeetingFromStorage() in meetings.js, the single choke point where this is
 * called so storage/webhook/download/LLM/Obsidian markdown all see the corrected text).
 * Pure — returns a new array, never mutates `transcript` or its blocks. Entries with no
 * (or blank) `replacement` are skipped entirely, since they're reference-only. Matching is
 * case-insensitive and whole-word, defined as "not adjacent to an alphanumeric character"
 * (rather than regex `\b`, which misfires on words ending in punctuation, e.g. "C++" —
 * `\b` needs a word/non-word transition, and two non-word characters in a row never
 * produce one). This only correctly segments space/punctuation-delimited scripts (Latin,
 * Cyrillic, etc.) — scriptio-continua languages (e.g. Thai, Chinese) aren't handled and
 * are out of scope here.
 * @param {TranscriptBlock[]} transcript
 * @param {DictionaryEntry[]} words
 * @returns {TranscriptBlock[]}
 */
export function applyDictionaryReplacements(transcript, words) {
    const rules = (words || [])
        .filter((w) => w.word && w.word.trim() && w.replacement && w.replacement.trim())
        .map((w) => ({
            pattern: new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(w.word.trim())}(?![A-Za-z0-9])`, "gi"),
            replacement: w.replacement.trim(),
        }))

    return transcript.map((block) => {
        let transcriptText = block.transcriptText
        for (const rule of rules) {
            transcriptText = transcriptText.replace(rule.pattern, rule.replacement)
        }
        return { ...block, transcriptText }
    })
}

/**
 * Format chat messages into string
 * @param {ChatMessage[]} chatMessages
 */
export function getChatMessagesString(chatMessages) {
    let chatMessagesString = ""
    if (chatMessages.length > 0) {
        chatMessages.forEach(chatMessage => {
            chatMessagesString += `${chatMessage.personName} (${new Date(chatMessage.timestamp).toLocaleString("default", TIMEFORMAT).toUpperCase()})\n`
            chatMessagesString += chatMessage.chatMessageText
            chatMessagesString += "\n\n"
        })
    }
    return chatMessagesString
}

export function clearTabIdAndApplyUpdate() {
    // Nullify to indicate end of meeting processing
    chrome.storage.local.set({ meetingTabId: null }, function () {
        console.log("Meeting tab id cleared for next meeting")

        // Check if there's a deferred update
        chrome.storage.local.get(["isDeferredUpdatedAvailable"], function (resultLocalUntyped) {
            const resultLocal = /** @type {ResultLocal} */ (resultLocalUntyped)

            if (resultLocal.isDeferredUpdatedAvailable) {
                console.log("Applying deferred update")
                chrome.storage.local.set({ isDeferredUpdatedAvailable: false }, function () {
                    chrome.runtime.reload()
                })
            }
        })
    })
}

/**
 * Opens the extension popup programmatically.
 */
export function openExtensionPopup() {
    return new Promise((resolve, reject) => {
        chrome.action.openPopup()
            .then(() => {
                console.log("Popup opened successfully")
                resolve("Popup opened")
            })
            .catch((error) => {
                console.error("Failed to open popup:", error)
                reject("Failed to open popup")
            })
    })
}

/**
 * Opens the side panel programmatically for the active tab
 */
export function openSidePanel() {
    return new Promise((resolve, reject) => {
        // Get the current active tab
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const activeTab = tabs[0]
            if (!activeTab || !activeTab.id) {
                console.error("No active tab found.")
                reject("No active tab found")
                return
            }

            // Open the side panel targeting that specific tab ID
            chrome.sidePanel.open({ tabId: activeTab.id })
                .then(() => {
                    console.log("Side panel opened successfully")
                    resolve("Side panel opened")
                })
                .catch((error) => {
                    console.error("Failed to open side panel:", error)
                    reject("Failed to open side panel")
                })
        })
    })
}

export function checkPermissionsAndOpenMeetingsPage() {
    console.log("Check permissions")
    chrome.storage.sync.get(["wantGoogleMeet", "wantTeams", "wantZoom"], function (resultSyncUntyped) {
        const resultSync = /** @type {ResultSync} */ (resultSyncUntyped)

        /** @type {Platform[]} */
        const wantedPlatforms = []
        //  Consider enabled if user has not explicitly opted out
        if (resultSync.wantGoogleMeet) {
            wantedPlatforms.push("google_meet")
        }
        if (resultSync.wantTeams) {
            wantedPlatforms.push("teams")
        }
        if (resultSync.wantZoom) {
            wantedPlatforms.push("zoom")
        }

        /** @type {ExtensionMessage} */
        const message = {
            type: "get_platform_permission_status",
            platform: wantedPlatforms
        }
        getPermissionStatus(wantedPlatforms).then((result) => {
            console.log(result)

            /** @type {Platform[]} */
            const permissionMissingPlatforms = []

            for (let i = 0; i < wantedPlatforms.length; i++) {
                if (Array.isArray(result) && result[i] === "Disabled") {
                    permissionMissingPlatforms.push(wantedPlatforms[i])
                }
            }

            if (permissionMissingPlatforms.length > 0) {
                console.log(permissionMissingPlatforms)
                chrome.tabs.create({
                    url: chrome.runtime.getURL("meetings.html")
                })
            }
        })
    })
}
