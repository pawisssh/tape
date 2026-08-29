import { useEffect, useRef } from "react"
import { toast } from "@/components/ui/toast"
import { writeTextWithFallback } from "@/lib/clipboard"
import MeetingHeaderStats from "./MeetingHeaderStats"
import DetailTabs from "./DetailTabs"
// Framework-free logic module, imported directly — never duplicated into src/. See
// PLAN.md §6 Phase 5 "Structural rule to preserve". Run now does the whole Save-to-
// Obsidian flow in place (no more opening a separate handoff tab for a manual save) —
// see extension/obsidian/save-flow.js's own header comment for why this is safe and why
// the automatic post-meeting-end save still uses the separate tab.
import { runSaveToObsidianFlow } from "../../../extension/obsidian/save-flow.js"

interface MeetingDetailProps {
    meeting: Meeting
    onRenamed: (newTitle: string) => void
    onNotesSave: (userNotes: string) => void
    onToggleActionItem: (itemIndex: number) => void
    // Lifted to MeetingsView.tsx (the shared parent of this component and
    // MeetingDetailToolbar.tsx, which triggers the other kind of operation — a template-
    // change regeneration) and keyed by meeting id so a stale resolution for a meeting the
    // user has since navigated away from can't clobber the currently-shown status bar.
    operation: MeetingOperation | null
    onOperationChange: (operation: MeetingOperation | null) => void
}

// save-flow.js only reports stable step ids/statuses (see its own "callers own their own
// wording" comment) — this is the sticky-bar label for each one.
const RUN_STEP_LABELS: Record<SaveFlowStepId, string> = {
    load: "Loading meeting…",
    llm: "Summarizing…",
    markdown: "Building note…",
    deliver: "Copying to clipboard…",
    launch: "Opening Obsidian…",
}

// Rendered in the Meetings page's detail panel for whichever row is currently selected
// (see MeetingsView.tsx / MeetingListRow.tsx). The Copy/Download/More icon toolbar and
// the Follow-up template picker live in a sibling component, MeetingDetailToolbar.tsx,
// rendered separately into MeetingsView.tsx's `detailTitle` slot (MasterDetailLayout's
// sticky h-16 header) — per Figma those sit ABOVE the title/stats seen here, and
// MasterDetailLayout has no way to interleave content between its two slots, so the two
// pieces must be split like this rather than living in one component.
export default function MeetingDetail({ meeting, onRenamed, onNotesSave, onToggleActionItem, operation, onOperationChange }: MeetingDetailProps) {
    // Stable id — must match extension/obsidian/store.js's getMeetingId().
    const meetingId = meeting.meetingStartTimestamp
    const statusLabel = operation?.meetingId === meetingId ? operation.label : null

    // This component remounts per-meeting (see MeetingsView.tsx's `key={...meetingId}`),
    // but `runSaveToObsidianFlow` isn't cancelled on unmount (no abort primitive exists —
    // see OperationStatusBar.tsx's own header comment) and keeps running detached. Guards
    // every onOperationChange call below so a late resolution from a meeting the user has
    // since navigated away from can never clobber whatever operation (possibly for a
    // different meeting entirely) is currently tracked in storage.
    const isMountedRef = useRef(true)
    useEffect(() => {
        isMountedRef.current = true
        return () => {
            isMountedRef.current = false
        }
    }, [])

    async function handleSaveToObsidian() {
        try {
            const result = await runSaveToObsidianFlow(meetingId, {
                onStep: (stepId, stepStatus) => {
                    if (stepStatus === "active" && isMountedRef.current) {
                        onOperationChange({ meetingId, label: RUN_STEP_LABELS[stepId] })
                    }
                },
                writeToClipboard: writeTextWithFallback,
            })
            if (isMountedRef.current) onOperationChange(null)

            if (result.success) {
                toast.add({ title: "Saved to Obsidian", type: "success" })
                return
            }
            if (result.message.errorCode === "018") {
                toast.add({
                    title: "Obsidian vault not configured",
                    description: "Configure and save an Obsidian vault name first.",
                    type: "warning",
                })
            } else {
                toast.add({ title: "Could not save to Obsidian", description: result.message.errorMessage, type: "error" })
            }
        } catch (err) {
            // Defense-in-depth: runSaveToObsidianFlow() is documented to never throw, same
            // contract as enrichWithLlm() one layer down, but this is a live SPA tab, not a
            // disposable one — an unexpected throw here must never leave Run stuck disabled.
            if (isMountedRef.current) onOperationChange(null)
            console.error("[MeetingDetail] save-to-Obsidian flow threw unexpectedly", err)
            toast.add({ title: "Could not save to Obsidian", type: "error" })
        }
    }

    return (
        <div className="flex min-h-full flex-col">
            <div className="flex flex-col gap-2 border-b border-meetings-border px-4 py-2">
                <h2
                    contentEditable
                    suppressContentEditableWarning
                    title="Rename"
                    className="font-meetings-heading focus-visible:ring-ring/50 w-fit max-w-full truncate rounded p-0.5 text-[34px] font-normal text-meetings-ink outline-none hover:outline hover:outline-meetings-border focus-visible:ring-3"
                    onBlur={(e) => onRenamed(e.currentTarget.innerText)}
                >
                    {meeting.meetingTitle || meeting.title || "Google Meet call"}
                </h2>

                <MeetingHeaderStats meeting={meeting} />
            </div>

            <DetailTabs
                meeting={meeting}
                statusLabel={statusLabel}
                onRun={handleSaveToObsidian}
                onDismissStatus={() => onOperationChange(null)}
                onToggleActionItem={onToggleActionItem}
                onNotesSave={onNotesSave}
            />
        </div>
    )
}
