import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { getLocal, onStorageChanged, setLocal } from "@/lib/chrome-storage"
import { asErrorObject, sendMessage } from "@/lib/messaging"
import AgendaMeetingRow from "../agenda/AgendaMeetingRow"
import { groupMeetingsByDay } from "../agenda/group-by-day"

export default function MeetingsView() {
    const [meetings, setMeetings] = useState<Meeting[]>([])
    const [isRecovering, setIsRecovering] = useState(false)
    const [isExpanded, setIsExpanded] = useState(false)
    const [needsExpandButton, setNeedsExpandButton] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)

    function loadMeetings() {
        getLocal<ResultLocal>(["meetings"]).then((result) => {
            setMeetings(result.meetings || [])
        })
    }

    useEffect(() => {
        loadMeetings()

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

    useEffect(() => {
        if (isExpanded || !containerRef.current) {
            setNeedsExpandButton(false)
            return
        }
        setNeedsExpandButton(containerRef.current.clientHeight > 480)
    }, [meetings, isExpanded])

    function handleRecoverLastMeeting() {
        setIsRecovering(true)
        sendMessage({ type: "recover_last_meeting" }).then((response) => {
            setIsRecovering(false)
            loadMeetings()
            window.scrollTo({ top: 0, behavior: "smooth" })
            if (response.success) {
                alert(response.message === "No recovery needed" ? "Nothing to recover—you're on top of the world!" : "Last meeting recovered successfully!")
            } else {
                const parsedError = asErrorObject(response.message)
                if (parsedError?.errorCode === "013") {
                    alert(parsedError.errorMessage)
                } else if (parsedError?.errorCode === "014") {
                    alert("Nothing to recover—you're on top of the world!")
                } else {
                    alert("Could not recover last meeting!")
                    console.error(parsedError?.errorMessage)
                }
            }
        })
    }

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
    }

    // Reverse-order display (latest first) while keeping each row's `index` prop tied to
    // the underlying storage array position — download/webhook/delete/obsidian all
    // address meetings by that index.
    const displayOrder = meetings.map((meeting, index) => ({ meeting, index })).reverse()
    const dayGroups = groupMeetingsByDay(displayOrder)

    return (
        <div>
            <div className="mb-4 flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">Meetings</h1>
                    <p className="text-muted-foreground mt-1 text-sm">Your last {meetings.length} meetings.</p>
                </div>
                <Button variant="outline" disabled={isRecovering} onClick={handleRecoverLastMeeting}>
                    {isRecovering ? "Recovering…" : "Recover last meeting"}
                </Button>
            </div>

            <div
                ref={containerRef}
                className={`overflow-hidden rounded-xl border ${!isExpanded && needsExpandButton ? "relative max-h-[30rem] [mask-image:linear-gradient(to_bottom,black_0%,black_85%,transparent_100%)]" : ""}`}
            >
                {dayGroups.length > 0 ? (
                    dayGroups.map((group) => (
                        <div key={group.key}>
                            <div className="bg-muted/40 flex items-center justify-between border-b px-3 py-2">
                                <span className="text-sm font-bold">{group.label}</span>
                                <span className="text-muted-foreground text-xs">
                                    {group.meetings.length} meeting{group.meetings.length === 1 ? "" : "s"}
                                </span>
                            </div>
                            {group.meetings.map(({ meeting, index }) => (
                                <AgendaMeetingRow
                                    key={meeting.meetingStartTimestamp}
                                    meeting={meeting}
                                    index={index}
                                    onRenamed={handleRenamed}
                                    onDeleted={handleDeleted}
                                    onChanged={loadMeetings}
                                />
                            ))}
                        </div>
                    ))
                ) : (
                    <p className="text-muted-foreground p-4 text-sm">Your next meeting will show up here.</p>
                )}
            </div>
            {needsExpandButton ? (
                <button
                    type="button"
                    className="border-primary text-primary mx-auto mt-3 block rounded-full border px-3 py-1 text-sm"
                    onClick={() => setIsExpanded(true)}
                >
                    Show all
                </button>
            ) : null}
        </div>
    )
}
