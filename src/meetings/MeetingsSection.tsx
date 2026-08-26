import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { getLocal, onStorageChanged, setLocal } from "@/lib/chrome-storage"
import { asErrorObject, sendMessage } from "@/lib/messaging"
import MeetingRow from "./MeetingRow"

export default function MeetingsSection() {
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
        setNeedsExpandButton(containerRef.current.clientHeight > 280)
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
    // the underlying storage array position — download/webhook/delete all address
    // meetings by that index.
    const displayOrder = meetings.map((meeting, index) => ({ meeting, index })).reverse()

    return (
        <section id="last-10-meetings" className="mb-20">
            <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-bold">Last 10 meetings</h2>
                <Button variant="outline" disabled={isRecovering} onClick={handleRecoverLastMeeting}>
                    {isRecovering ? "Recovering…" : "Recover last meeting"}
                </Button>
            </div>
            <div
                ref={containerRef}
                className={`overflow-x-auto ${!isExpanded && needsExpandButton ? "max-h-80 overflow-y-hidden [mask-image:linear-gradient(to_bottom,black_0%,black_90%,transparent_100%)]" : ""}`}
            >
                <table className="bg-foreground/5 w-full border-collapse rounded-lg">
                    <thead>
                        <tr className="bg-primary/10">
                            <th className="px-4 py-3 text-left font-bold">Meeting title</th>
                            <th className="px-4 py-3 text-left font-bold">Meeting software</th>
                            <th className="px-4 py-3 text-left font-bold">Meeting start time and duration</th>
                            <th className="px-4 py-3 text-left font-bold">Webhook status</th>
                            <th className="px-4 py-3 text-left font-bold">Obsidian status</th>
                            <th className="px-4 py-3 text-left font-bold">Summary</th>
                            <th className="px-4 py-3"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {displayOrder.length > 0 ? (
                            displayOrder.map(({ meeting, index }) => (
                                <MeetingRow
                                    key={meeting.meetingStartTimestamp}
                                    meeting={meeting}
                                    index={index}
                                    onRenamed={handleRenamed}
                                    onDeleted={handleDeleted}
                                    onChanged={loadMeetings}
                                />
                            ))
                        ) : (
                            <tr>
                                <td colSpan={7} className="px-4 py-3">
                                    Your next meeting will show up here
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
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
        </section>
    )
}
