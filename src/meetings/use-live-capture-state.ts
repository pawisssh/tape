import { useEffect, useState } from "react"
import { getLocal, onStorageChanged } from "@/lib/chrome-storage"

interface LiveCaptureState {
    isCapturing: boolean
    isProcessing: boolean
}

// `chrome.storage.local.meetingTabId` is already the extension's single source of truth
// for "is a meeting being captured right now" — set to a tab id on new_meeting_started,
// "processing" while processLastMeeting() runs, and cleared to null once done (see
// extension/background-script/utils.js's clearTabIdAndApplyUpdate()). No new message
// type needed: this just reads/subscribes to that existing key, the same way
// src/side-panel/App.tsx already does for its own live-transcript view.
export function useLiveCaptureState(): LiveCaptureState {
    const [meetingTabId, setMeetingTabId] = useState<MeetingTabId>(null)

    useEffect(() => {
        getLocal<ResultLocal>(["meetingTabId"]).then((result) => {
            setMeetingTabId(result.meetingTabId ?? null)
        })
        return onStorageChanged((changes, area) => {
            if (area === "local" && changes.meetingTabId) {
                setMeetingTabId((changes.meetingTabId.newValue as MeetingTabId) ?? null)
            }
        })
    }, [])

    return {
        isCapturing: typeof meetingTabId === "number",
        isProcessing: meetingTabId === "processing",
    }
}
