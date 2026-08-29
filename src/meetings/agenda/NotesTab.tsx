import { useState } from "react"
import { Textarea } from "@/components/ui/textarea"
import { useDebouncedEffect } from "@/hooks/use-debounced-effect"

interface NotesTabProps {
    meeting: Meeting
    onSave: (userNotes: string) => void
}

// Freeform per-meeting notes — no AI involvement, plain user-authored text. Autosaved
// via the same debounced pattern every other settings field in the app uses; the
// meeting's own id as `resetKey` means switching meetings (this component is remounted
// via a `key` prop by the caller, but resetKey is kept too for belt-and-suspenders)
// never cross-saves one meeting's edit into another.
export default function NotesTab({ meeting, onSave }: NotesTabProps) {
    const [notes, setNotes] = useState(meeting.userNotes || "")

    useDebouncedEffect(
        () => {
            onSave(notes)
        },
        [notes],
        600,
        meeting.meetingStartTimestamp,
    )

    return (
        <div className="px-4 py-4">
            <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes for this meeting…"
                className="min-h-48 rounded-none border-meetings-border font-meetings-body text-sm"
            />
        </div>
    )
}
