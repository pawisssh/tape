import { groupTranscriptBySpeaker } from "../../../extension/obsidian/markdown.js"

interface TranscriptTabProps {
    transcript: Transcript
}

function formatTurnTime(isoTimestamp: string) {
    const d = new Date(isoTimestamp)
    if (isNaN(d.getTime())) return ""
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

// In-page transcript viewer — today's MeetingDetail.tsx has no equivalent at all (only
// the exported markdown includes a transcript); reuses markdown.js's speaker-grouping so
// this reads identically to what ends up in the Obsidian note.
export default function TranscriptTab({ transcript }: TranscriptTabProps) {
    const turns = groupTranscriptBySpeaker(transcript)

    if (turns.length === 0) {
        return <p className="px-4 py-4 text-sm text-meetings-ink-muted">No transcript captured for this meeting.</p>
    }

    return (
        <div className="flex flex-col gap-4 px-4 py-4">
            {turns.map((turn, i) => (
                <div key={i}>
                    <p className="mb-1 flex items-baseline gap-2">
                        <span className="font-meetings-heading text-sm font-medium text-meetings-ink">{turn.personName}</span>
                        <span className="font-meetings-mono text-[10px] text-meetings-ink-faint">{formatTurnTime(turn.timestamp)}</span>
                    </p>
                    <p className="text-sm whitespace-pre-wrap text-meetings-ink-muted">{turn.text}</p>
                </div>
            ))}
        </div>
    )
}
