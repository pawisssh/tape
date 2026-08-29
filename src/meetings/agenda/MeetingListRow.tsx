import { cn } from "@/lib/utils"

function webhookStatusNote(status: Meeting["webhookPostStatus"]): string | null {
    return status === "failed" ? "Webhook failed" : null
}

function obsidianStatusNote(status: Meeting["obsidianSaveStatus"]): string | null {
    switch (status) {
        case "failed":
            return "Obsidian failed"
        case "pending":
            return "Obsidian pending"
        default:
            return null
    }
}

interface MeetingListRowProps {
    meeting: Meeting
    selected: boolean
    onSelect: () => void
}

// Compact row only — the full detail (rename, summary, actions) lives in MeetingDetail.tsx,
// shown in the page's detail panel for whichever row is selected (see MeetingsView.tsx).
// Per Figma: title/subtitle opacity never changes with selection or day-group recency —
// only the time column does (black/60 selected, black/38 otherwise), alongside the
// selected row's bg-black/8 background.
export default function MeetingListRow({ meeting, selected, onSelect }: MeetingListRowProps) {
    const startDate = new Date(meeting.meetingStartTimestamp)
    const endDate = new Date(meeting.meetingEndTimestamp)
    const startLabel = startDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    const endLabel = endDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })

    const statusNote = webhookStatusNote(meeting.webhookPostStatus) || obsidianStatusNote(meeting.obsidianSaveStatus)

    return (
        <button
            type="button"
            onClick={onSelect}
            className={cn("flex h-16 w-full items-center px-4 text-left", selected && "bg-black/8")}
        >
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-black/87 uppercase">
                    {meeting.meetingTitle || meeting.title || "Google Meet call"}
                </p>
                <p className="mt-1 truncate text-xs text-black/60">
                    {meeting.meetingSoftware || "Meeting"}
                    {statusNote ? ` · ${statusNote}` : ""}
                </p>
            </div>
            <div className={cn("flex shrink-0 flex-col items-end text-sm uppercase", selected ? "text-black/60" : "text-black/38")}>
                <span>{startLabel}</span>
                <span>{endLabel}</span>
            </div>
        </button>
    )
}
