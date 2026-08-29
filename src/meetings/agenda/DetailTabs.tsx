import { useState } from "react"
import { cn } from "@/lib/utils"
import { PlayArrowFillIcon } from "../ui/icons"
import SummaryPanel from "../summary/SummaryPanel"
import TranscriptTab from "./TranscriptTab"
import NotesTab from "./NotesTab"
import OperationStatusBar from "./OperationStatusBar"

type Tab = "summary" | "transcript" | "notes"

const TABS: { id: Tab; label: string }[] = [
    { id: "summary", label: "Summary" },
    { id: "transcript", label: "Transcript" },
    { id: "notes", label: "Notes" },
]

interface DetailTabsProps {
    meeting: Meeting
    statusLabel: string | null
    onRun: () => void
    onDismissStatus: () => void
    onToggleActionItem: (itemIndex: number) => void
    onNotesSave: (userNotes: string) => void
}

// Summary/Transcript/Notes as real switchable tabs, with RUN in the same row (a
// rename/restyle of the existing "Save to Obsidian" action — same handler, just promoted
// next to the tab bar instead of sitting below it). `statusLabel` (non-null while either a
// template-triggered regeneration or a Run is in flight for this meeting — see
// MeetingsView.tsx's lifted `operation` state) disables Run and drives the sticky
// OperationStatusBar below the tab content.
//
// The tab bar itself is `sticky top-0` so it stays pinned once the meeting title/stats
// block above it (MeetingDetail.tsx) scrolls out of view — both live inside the same
// scrolling ancestor (MasterDetailLayout's `detail` column, the nearest `overflow-y-auto`
// up the tree), so `sticky` bubbles up to that without needing any wiring here.
export default function DetailTabs({
    meeting,
    statusLabel,
    onRun,
    onDismissStatus,
    onToggleActionItem,
    onNotesSave,
}: DetailTabsProps) {
    const [activeTab, setActiveTab] = useState<Tab>("summary")

    return (
        <div className="flex flex-1 flex-col">
            <div className="sticky top-0 z-10 flex h-16 w-full items-stretch">
                {TABS.map((tab, i) => (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        className={cn(
                            "font-meetings-heading flex flex-1 flex-col items-center justify-center border-b p-2 text-xs font-normal uppercase",
                            i < TABS.length - 1 && "border-r border-r-meetings-border",
                            activeTab === tab.id
                                ? "border-b-transparent bg-meetings-card text-meetings-ink"
                                : "border-b-meetings-border bg-meetings-surface text-meetings-ink-muted",
                        )}
                    >
                        {tab.label}
                    </button>
                ))}
                <button
                    type="button"
                    disabled={statusLabel !== null}
                    onClick={onRun}
                    className="bg-meetings-accent font-meetings-heading flex flex-1 flex-col items-start justify-between border-b border-meetings-border px-4 py-2 text-xs font-normal text-white transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
                >
                    <span className="uppercase">{statusLabel !== null ? "Running…" : "Run"}</span>
                    <PlayArrowFillIcon className="size-3.5" />
                </button>
            </div>

            <div className="flex-1 bg-meetings-card">
                {activeTab === "summary" ? (
                    <SummaryPanel markdown={meeting.llmSummaryMarkdown} onToggleActionItem={onToggleActionItem} />
                ) : null}
                {activeTab === "transcript" ? <TranscriptTab transcript={meeting.transcript} /> : null}
                {activeTab === "notes" ? <NotesTab key={meeting.meetingStartTimestamp} meeting={meeting} onSave={onNotesSave} /> : null}
            </div>

            {statusLabel ? <OperationStatusBar label={statusLabel} onDismiss={onDismissStatus} /> : null}
        </div>
    )
}
