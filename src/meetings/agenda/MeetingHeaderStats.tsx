import { getParticipants } from "../../../extension/obsidian/markdown.js"
import { formatDuration } from "./format-duration"

interface MeetingHeaderStatsProps {
    meeting: Meeting
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="font-meetings-heading flex flex-col text-sm font-medium text-black/38">
            <span>{label}</span>
            <span className="lowercase">{value}</span>
        </div>
    )
}

// Replaces the old single plain "time · duration · software" line with the Figma
// design's date/time/duration/app/participants stat row. Label and value share the same
// typographic treatment per Figma (Space Grotesk Medium, 14px, black/38) — this is not
// the sidebar's all-caps mono system-label style.
export default function MeetingHeaderStats({ meeting }: MeetingHeaderStatsProps) {
    const start = new Date(meeting.meetingStartTimestamp)
    const end = new Date(meeting.meetingEndTimestamp)
    const dateLabel = start.toLocaleDateString([], { month: "short", day: "numeric" })
    const timeLabel = `${start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} - ${end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    const durationLabel = formatDuration(meeting.meetingStartTimestamp, meeting.meetingEndTimestamp)
    const participants = getParticipants(meeting.transcript, meeting.chatMessages)

    return (
        <div className="flex flex-wrap items-center gap-6">
            <Stat label="date" value={dateLabel} />
            <Stat label="time" value={timeLabel} />
            <Stat label="duration" value={durationLabel} />
            <Stat label="app" value={meeting.meetingSoftware || "Meeting"} />
            <Stat label="participants" value={String(participants.length)} />
        </div>
    )
}
