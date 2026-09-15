import { useEffect, useRef, useState } from "react"
import { getLocal, onStorageChanged, removeLocal, setLocal } from "@/lib/chrome-storage"
import { sendMessage } from "@/lib/messaging"
import { toast } from "@/components/ui/toast"
import CircleIconButton from "../ui/CircleIconButton"
import { UploadIcon } from "../ui/icons"
import MasterDetailLayout from "../components/MasterDetailLayout"
import MobileBackButton from "../components/MobileBackButton"
import MeetingListRow from "../agenda/MeetingListRow"
import MeetingDetail from "../agenda/MeetingDetail"
import MeetingDetailToolbar from "../agenda/MeetingDetailToolbar"
import { groupMeetingsByDay } from "../agenda/group-by-day"
import { toggleActionItemDone } from "../summary/parse-summary-markdown"
import { parseGoogleMeetTranscript } from "../import/parse-google-meet-transcript"

export default function MeetingsView() {
    const [meetings, setMeetings] = useState<Meeting[]>([])
    // Stable id — matches extension/obsidian/store.js's getMeetingId() (meetingStartTimestamp).
    const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null)
    const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
    // Whichever of "Run" (MeetingDetail.tsx) or a template-triggered regenerate
    // (MeetingDetailToolbar.tsx) is in flight for the currently-selected meeting — lifted
    // here since those two components are siblings (MasterDetailLayout's `detailTitle` vs.
    // `detail` slots) that both need to read/drive the same sticky status bar. Keyed by
    // meeting id so a stale resolution for a meeting the user has since navigated away
    // from can't clobber whichever meeting's bar is currently showing.
    //
    // Backed by chrome.storage.local (`activeMeetingOperation`, mirroring meetingTabId's
    // pattern in use-live-capture-state.ts) rather than plain useState, so it's a single
    // source of truth independent of this component's own mount lifetime: switching to
    // another sidebar page (Integrations/Templates/Settings) unmounts this whole view and
    // would otherwise silently forget an operation that's still genuinely running in the
    // background — storage means it's correctly restored if the user comes back to
    // Meetings before it finishes, and correctly absent once it's actually done.
    const [operation, setOperationState] = useState<MeetingOperation | null>(null)

    useEffect(() => {
        getLocal<ResultLocal>(["activeMeetingOperation"]).then((result) => {
            setOperationState(result.activeMeetingOperation ?? null)
        })
        return onStorageChanged((changes, area) => {
            if (area === "local" && changes.activeMeetingOperation) {
                setOperationState((changes.activeMeetingOperation.newValue as MeetingOperation | undefined) ?? null)
            }
        })
    }, [])

    function setOperation(next: MeetingOperation | null) {
        setOperationState(next)
        if (next) {
            setLocal({ activeMeetingOperation: next })
        } else {
            removeLocal("activeMeetingOperation")
        }
    }

    // How the sticky status bar's Stop button actually cancels the in-flight LLM request
    // (see extension/obsidian/llm.js's `signal` param) — necessarily separate from
    // `operation` above, since that's persisted through chrome.storage.local (JSON-only,
    // can't hold a function) and survives across this whole page's own remounts. Keyed by
    // meeting id, not a single slot, so switching meetings while an old, abandoned
    // operation is still quietly running in the background (see MeetingDetail.tsx's own
    // comment on that) can never cancel the *wrong* meeting's operation.
    const cancelHandlersRef = useRef<Map<string, () => void>>(new Map())

    function registerCancel(meetingId: string, fn: (() => void) | null) {
        if (fn) {
            cancelHandlersRef.current.set(meetingId, fn)
        } else {
            cancelHandlersRef.current.delete(meetingId)
        }
    }

    function cancelOperation(meetingId: string) {
        cancelHandlersRef.current.get(meetingId)?.()
    }

    const importFileInputRef = useRef<HTMLInputElement>(null)

    function loadMeetings() {
        getLocal<ResultLocal>(["meetings"]).then((result) => {
            setMeetings(result.meetings || [])
        })
    }

    useEffect(() => {
        loadMeetings()

        // Recovery also runs automatically on every new meeting join (see each
        // platform's content-script init) and once per browser startup (see
        // chrome.runtime.onStartup in the background script) — this call covers the
        // remaining gap: the user opens the Meetings page without having rejoined a
        // meeting since a crash. Silent by design (no button, no loading state) since it
        // fires on every mount/visibility-change; only a genuine recovery gets a toast,
        // so the common "nothing to recover" case stays quiet.
        sendMessage({ type: "recover_last_meeting" }).then((response) => {
            if (response.success && response.message !== "No recovery needed") {
                toast.add({ title: "Recovered a meeting that didn't finish saving", type: "success" })
            }
            loadMeetings()
        })

        function onVisibilityChange() {
            if (document.visibilityState === "visible") {
                loadMeetings()
            }
        }
        document.addEventListener("visibilitychange", onVisibilityChange)
        const unsubscribe = onStorageChanged(() => loadMeetings())

        return () => {
            document.removeEventListener("visibilitychange", onVisibilityChange)
            unsubscribe()
        }
    }, [])

    function handleRenamed(index: number, newTitle: string) {
        const updated = [...meetings]
        updated[index] = { ...updated[index], meetingTitle: newTitle }
        setMeetings(updated)
        setLocal({ meetings: updated })
    }

    function handleDeleted(index: number) {
        const updated = [...meetings]
        updated.splice(index, 1)
        setMeetings(updated)
        setLocal({ meetings: updated })
        setSelectedMeetingId(null)
        setMobileDetailOpen(false)
    }

    function handleNotesSaved(index: number, userNotes: string) {
        const updated = [...meetings]
        updated[index] = { ...updated[index], userNotes }
        setMeetings(updated)
        setLocal({ meetings: updated })
    }

    function handleTemplateOverrideChanged(index: number, templateOverrideId: string | undefined) {
        const updated = [...meetings]
        updated[index] = { ...updated[index], templateOverrideId }
        setMeetings(updated)
        // Returned (not fire-and-forget) — MeetingDetailToolbar.tsx awaits this before
        // triggering a regenerate, since enrichWithLlm() reads templateOverrideId from
        // storage and must see the new value first.
        return setLocal({ meetings: updated })
    }

    function handleActionItemToggled(index: number, itemIndex: number) {
        const meeting = meetings[index]
        if (!meeting?.llmSummaryMarkdown) return
        const updated = [...meetings]
        updated[index] = { ...meeting, llmSummaryMarkdown: toggleActionItemDone(meeting.llmSummaryMarkdown, itemIndex) }
        setMeetings(updated)
        setLocal({ meetings: updated })
    }

    function handleImportFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        // Reset immediately so re-selecting the same filename still fires onChange.
        e.target.value = ""
        if (!file) return

        const reader = new FileReader()
        reader.onload = () => {
            const fileText = typeof reader.result === "string" ? reader.result.trim() : ""
            if (!fileText) {
                toast.add({ title: "Transcript file is empty", type: "error" })
                return
            }

            const now = new Date().toISOString()
            const parsedTranscript = parseGoogleMeetTranscript(fileText)
            const transcript: TranscriptBlock[] =
                parsedTranscript.length > 0
                    ? parsedTranscript
                    : [{ personName: "Imported transcript", timestamp: now, transcriptText: fileText }]

            const newMeeting: Meeting = {
                meetingSoftware: "",
                meetingTitle: file.name.replace(/\.txt$/i, ""),
                meetingStartTimestamp: transcript[0].timestamp,
                meetingEndTimestamp: transcript[transcript.length - 1].timestamp,
                transcript,
                chatMessages: [],
                webhookPostStatus: "new",
            }

            const updated = [...meetings, newMeeting]
            setMeetings(updated)
            setLocal({ meetings: updated })
            setSelectedMeetingId(newMeeting.meetingStartTimestamp)
            setMobileDetailOpen(true)
            toast.add({ title: "Transcript imported", type: "success" })
        }
        reader.onerror = () => {
            toast.add({ title: "Could not read transcript file", type: "error" })
        }
        reader.readAsText(file)
    }

    // Reverse-order display (latest first) while keeping each row's `index` prop tied to
    // the underlying storage array position — download/webhook/delete/obsidian all
    // address meetings by that index.
    const displayOrder = meetings.map((meeting, index) => ({ meeting, index })).reverse()
    const dayGroups = groupMeetingsByDay(displayOrder)

    // Falls back to the most recent meeting whenever nothing (or something no longer
    // present, e.g. just deleted) is selected — derived here rather than synced via an
    // effect, so it always reflects the current list.
    const selectedEntry =
        displayOrder.find(({ meeting }) => meeting.meetingStartTimestamp === selectedMeetingId) || displayOrder[0] || null

    return (
        <MasterDetailLayout
            className="meetings-redesign"
            contentTitle={
                <>
                    <h1 className="font-meetings-heading flex-1 text-xl text-meetings-ink">meetings</h1>
                    <input
                        ref={importFileInputRef}
                        type="file"
                        accept=".txt"
                        className="hidden"
                        onChange={handleImportFileChange}
                    />
                    <CircleIconButton
                        label="Import transcript"
                        icon={<UploadIcon />}
                        onClick={() => importFileInputRef.current?.click()}
                    />
                </>
            }
            content={
                <div className="flex flex-col py-2">
                    {dayGroups.length > 0 ? (
                        dayGroups.map((group) => (
                            <div key={group.key}>
                                <div className="flex h-9 items-center justify-between px-4">
                                    <span
                                        className={
                                            "font-meetings-heading text-sm font-medium lowercase " +
                                            (group.isToday ? "text-meetings-accent" : "text-meetings-ink-faint")
                                        }
                                    >
                                        {group.label}
                                    </span>
                                    <span
                                        className={
                                            "font-meetings-heading text-sm " +
                                            (group.isToday ? "font-bold text-meetings-accent" : "font-medium text-meetings-ink-faint")
                                        }
                                    >
                                        {group.meetings.length}
                                    </span>
                                </div>
                                {group.meetings.map(({ meeting, index }) => (
                                    <MeetingListRow
                                        key={meeting.meetingStartTimestamp}
                                        meeting={meeting}
                                        selected={meeting.meetingStartTimestamp === selectedEntry?.meeting.meetingStartTimestamp}
                                        onSelect={() => {
                                            setSelectedMeetingId(meeting.meetingStartTimestamp)
                                            setMobileDetailOpen(true)
                                        }}
                                    />
                                ))}
                            </div>
                        ))
                    ) : (
                        <p className="px-4 py-4 text-sm text-meetings-ink-muted">Your next meeting will show up here.</p>
                    )}
                </div>
            }
            detailTitle={
                selectedEntry ? (
                    <>
                        <MobileBackButton onClick={() => setMobileDetailOpen(false)} />
                        <MeetingDetailToolbar
                            key={selectedEntry.meeting.meetingStartTimestamp}
                            meeting={selectedEntry.meeting}
                            index={selectedEntry.index}
                            onDeleted={handleDeleted}
                            onChanged={loadMeetings}
                            onTemplateOverrideChange={(templateOverrideId) =>
                                handleTemplateOverrideChanged(selectedEntry.index, templateOverrideId)
                            }
                            operation={operation}
                            onOperationChange={setOperation}
                            onRegisterCancel={registerCancel}
                        />
                    </>
                ) : null
            }
            detail={
                selectedEntry ? (
                    <MeetingDetail
                        key={selectedEntry.meeting.meetingStartTimestamp}
                        meeting={selectedEntry.meeting}
                        onRenamed={(newTitle) => handleRenamed(selectedEntry.index, newTitle)}
                        onNotesSave={(userNotes) => handleNotesSaved(selectedEntry.index, userNotes)}
                        onToggleActionItem={(itemIndex) => handleActionItemToggled(selectedEntry.index, itemIndex)}
                        operation={operation}
                        onOperationChange={setOperation}
                        onRegisterCancel={registerCancel}
                        onCancelOperation={cancelOperation}
                    />
                ) : (
                    <p className="text-muted-foreground px-4 text-sm">Select a meeting to see its details.</p>
                )
            }
            mobileDetailOpen={mobileDetailOpen}
        />
    )
}
