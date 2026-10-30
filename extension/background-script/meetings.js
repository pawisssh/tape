import { getWords } from '../obsidian/dictionary.js'
import { applyDictionaryReplacements, formatCommentNotesAsUserNotes } from './utils.js'

// The Meeting lifecycle module: the one owner of the meeting tab (`meetingTabId`) and of
// finalizing a live meeting into a saved Meeting, exactly once (see GLOSSARY.md). Everything
// that happens after finalization — download, webhook, Obsidian handoff — is the injected
// after-finalize effect, not part of this module.

// Records which live meeting was last finalized (by its start timestamp), so recovery never
// finalizes the same live meeting twice — even after the user deletes or imports Meetings,
// which used to make "is it the last entry in `meetings`?" answer wrong.
const FINALIZED_MARKER_KEY = "lastFinalizedMeetingStartTimestamp"

const LIVE_MEETING_KEYS = [
    "meetingSoftware",
    "meetingTitle",
    "meetingStartTimestamp",
    "transcript",
    "chatMessages",
    "liveCommentNotes",
]

/**
 * @param {string[]} keys
 * @returns {Promise<ResultLocal>}
 */
function getLocal(keys) {
    return new Promise((resolve) => {
        chrome.storage.local.get(keys, (result) => resolve(/** @type {ResultLocal} */ (result)))
    })
}

/**
 * @param {Partial<ResultLocal>} items
 * @returns {Promise<void>}
 */
function setLocal(items) {
    return new Promise((resolve) => {
        chrome.storage.local.set(items, () => resolve())
    })
}

/**
 * @param {SkipReason} reason
 * @returns {LifecycleResult}
 */
function skipped(reason) {
    return { outcome: "skipped", reason }
}

/**
 * @param {ResultLocal} live
 */
function isFinalized(live) {
    const marker = live[FINALIZED_MARKER_KEY]
    if (marker !== undefined) {
        return marker === live.meetingStartTimestamp
    }
    // Installs from before the marker existed: fall back to searching every saved Meeting.
    return (live.meetings || []).some((meeting) => meeting.meetingStartTimestamp === live.meetingStartTimestamp)
}

/**
 * Builds the saved Meeting from the live meeting's storage keys. Runs the user's Dictionary
 * over the transcript first — the single choke point every downstream consumer (storage,
 * webhook/download, LLM prompt, Obsidian markdown) reads from afterward.
 * @param {ResultLocal} live
 * @returns {Promise<Meeting>}
 */
async function buildMeeting(live) {
    const words = await getWords()

    /** @type {Meeting} */
    const meeting = {
        meetingSoftware: live.meetingSoftware ? live.meetingSoftware : "",
        meetingTitle: live.meetingTitle,
        meetingStartTimestamp: live.meetingStartTimestamp,
        meetingEndTimestamp: new Date().toISOString(),
        transcript: applyDictionaryReplacements(live.transcript || [], words),
        chatMessages: live.chatMessages || [],
        webhookPostStatus: "new"
    }

    // Quick notes typed live via the floating widget become the meeting's starting
    // userNotes — the user can keep editing/appending them post-meeting via the Notes tab.
    const userNotes = formatCommentNotesAsUserNotes(live.liveCommentNotes)
    if (userNotes) {
        meeting.userNotes = userNotes
    }
    return meeting
}

/**
 * @param {unknown} error
 * @returns {ErrorObject}
 */
function toErrorObject(error) {
    const maybe = /** @type {Partial<ErrorObject>} */ (error)
    if (maybe && typeof maybe.errorCode === "string") {
        return { errorCode: maybe.errorCode, errorMessage: maybe.errorMessage || "" }
    }
    return { errorCode: "023", errorMessage: `Meeting finalization failed: ${String(error)}` }
}

/**
 * Creates the Meeting lifecycle module. Create one per service-worker instance.
 * @param {{ afterFinalize: (meeting: Meeting) => Promise<unknown> }} effects
 */
export function createMeetingLifecycle({ afterFinalize }) {
    // Chrome delivers extension events one at a time to a single service-worker context, so
    // a synchronous in-memory flag fully closes the race between the two end triggers
    // ("meeting_ended" and the meeting tab closing) — no storage lock needed.
    let finalizing = false
    // A new live meeting can start while the previous one is still finalizing (the
    // after-finalize effect may take seconds, and content scripts only wait 2s for
    // recovery). Its tab id must survive finalization clearing the meeting tab.
    /** @type {number | null} */
    let startedDuringFinalize = null

    /** @returns {Promise<LifecycleResult>} */
    async function finalize() {
        if (finalizing) return skipped("finalizing")
        finalizing = true
        try {
            const live = await getLocal([...LIVE_MEETING_KEYS, "meetings", FINALIZED_MARKER_KEY])
            if (!live.meetingStartTimestamp) {
                return skipped("nothing-live")
            }
            if (isFinalized(live)) {
                await setLocal({ [FINALIZED_MARKER_KEY]: live.meetingStartTimestamp })
                return skipped("already-finalized")
            }
            const hasContent = (live.transcript?.length > 0) || (live.chatMessages?.length > 0) || (live.liveCommentNotes?.length > 0)
            if (!hasContent) {
                // Nothing to save, but still finalized: recovery must not keep retrying it.
                await setLocal({ [FINALIZED_MARKER_KEY]: live.meetingStartTimestamp })
                return skipped("empty")
            }

            // Holds back deferred extension updates until the after-finalize effect settles.
            if (startedDuringFinalize === null) {
                await setLocal({ meetingTabId: "processing" })
            }
            const meeting = await buildMeeting(live)

            // Re-read right before writing: the Meetings page may have changed the list
            // while the Dictionary was being read.
            const { meetings = [] } = await getLocal(["meetings"])
            meetings.push(meeting)
            // Saved and marked in one write, so a crash can't leave one without the other.
            await setLocal({ meetings, [FINALIZED_MARKER_KEY]: meeting.meetingStartTimestamp })

            try {
                await afterFinalize(meeting)
                return { outcome: "finalized", meeting }
            } catch (afterFinalizeError) {
                return { outcome: "finalized", meeting, afterFinalizeError: toErrorObject(afterFinalizeError) }
            }
        } catch (error) {
            return { outcome: "failed", error: toErrorObject(error) }
        } finally {
            await setLocal({ meetingTabId: startedDuringFinalize })
            startedDuringFinalize = null
            finalizing = false
        }
    }

    return {
        /**
         * A live meeting started capturing in this tab; it becomes the meeting tab.
         * @param {number} tabId
         */
        meetingStarted(tabId) {
            if (finalizing) startedDuringFinalize = tabId
            return setLocal({ meetingTabId: tabId })
        },

        /**
         * The live meeting ended: the user clicked the platform's end-call button ("message"),
         * or a tab closed ("tab-closed", which only counts if it is the meeting tab).
         * @param {{ via: "message" } | { via: "tab-closed", tabId: number }} trigger
         * @returns {Promise<LifecycleResult>}
         */
        async meetingEnded(trigger) {
            if (trigger.via === "tab-closed") {
                const { meetingTabId } = await getLocal(["meetingTabId"])
                if (meetingTabId !== trigger.tabId) return skipped("not-meeting-tab")
            }
            return finalize()
        },

        /**
         * Finalizes a live meeting whose finalization never ran or was interrupted.
         * - "meeting-join": a content script is about to start a new live meeting and
         *   overwrite the live keys, so whatever is live is finalized first — whether its
         *   tab just reloaded or is another, still-open tab.
         * - "startup": nothing survives a browser restart, so a stored meeting tab id or a
         *   leftover "processing" both mean the live meeting was stranded.
         * - "meetings-page": skipped while the meeting tab is still capturing or finalizing.
         * @param {RecoveryContext} context
         * @returns {Promise<LifecycleResult>}
         */
        async recover(context) {
            if (finalizing) return skipped("finalizing")
            if (context !== "meeting-join") {
                const { meetingTabId } = await getLocal(["meetingTabId"])
                if (meetingTabId === "processing" && context !== "startup") {
                    return skipped("finalizing")
                }
                if (typeof meetingTabId === "number" && await isTabOpen(meetingTabId)) {
                    return skipped("capturing")
                }
            }
            return finalize()
        },
    }
}

/**
 * @param {number} tabId
 * @returns {Promise<boolean>}
 */
function isTabOpen(tabId) {
    return new Promise((resolve) => {
        chrome.tabs.get(tabId, () => resolve(!chrome.runtime.lastError))
    })
}
