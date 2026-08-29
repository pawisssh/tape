import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { writeTextWithFallback } from "@/lib/clipboard"

// Framework-free logic module, imported directly — never duplicated into src/. See
// PLAN.md §6 Phase 5 "Structural rule to preserve". This page no longer owns the actual
// "Save to Obsidian" work itself (see extension/obsidian/save-flow.js) — it's now just
// one of two presentations of that shared flow, the other being the Meetings page's own
// inline "Run" button (src/meetings/agenda/MeetingDetail.tsx). This page still runs for
// the automatic post-meeting-end save, opened in its own tab (see
// extension/background-script/meetings.js's triggerObsidianHandoffIfConfigured()) since
// there's no Meetings page necessarily open at that moment.
import { runSaveToObsidianFlow } from "../../extension/obsidian/save-flow.js"

type StepStatus = SaveFlowStepStatus | "pending"

interface StepState {
    id: SaveFlowStepId
    label: string
    status: StepStatus
    detail?: string
}

const INITIAL_STEPS: StepState[] = [
    { id: "load", label: "Load meeting", status: "pending" },
    { id: "llm", label: "Summarize with local LLM", status: "pending" },
    { id: "markdown", label: "Build note", status: "pending" },
    { id: "deliver", label: "Copy to clipboard", status: "pending" },
    { id: "launch", label: "Open Obsidian", status: "pending" },
]

const statusStyles: Record<StepStatus, string> = {
    pending: "bg-muted text-muted-foreground",
    active: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    done: "bg-green-500/15 text-green-600 dark:text-green-400",
    skipped: "bg-muted text-muted-foreground",
    failed: "bg-destructive/15 text-destructive",
}

const statusLabels: Record<StepStatus, string> = {
    pending: "Pending",
    active: "Working…",
    done: "Done",
    skipped: "Skipped",
    failed: "Failed",
}

const SUCCESS_MESSAGE: Record<"inline" | "clipboard", string> = {
    inline: "Opening Obsidian…",
    clipboard: 'Copied to clipboard. Opening Obsidian — if the note body is empty, paste with Cmd/Ctrl+V.',
}

export default function App() {
    const [meetingTitle, setMeetingTitle] = useState("Loading meeting…")
    const [steps, setSteps] = useState<StepState[]>(INITIAL_STEPS)
    const [finalMessage, setFinalMessage] = useState("Starting…")
    const [retryable, setRetryable] = useState(false)
    const ranOnce = useRef(false)

    function patchStep(id: SaveFlowStepId, patch: Partial<StepState>) {
        setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
    }

    async function run() {
        setSteps(INITIAL_STEPS)
        setFinalMessage("Starting…")
        setRetryable(false)

        const params = new URLSearchParams(window.location.search)
        const meetingId = params.get("meetingId")

        if (!meetingId) {
            patchStep("load", { status: "failed", detail: "No meetingId in the URL." })
            setFinalMessage("This page must be opened with a meetingId parameter.")
            return
        }

        const result = await runSaveToObsidianFlow(meetingId, {
            onStep: (stepId, status, detail) => patchStep(stepId, { status, detail }),
            writeToClipboard: writeTextWithFallback,
            onMeetingLoaded: (meeting) => setMeetingTitle(meeting.meetingTitle || meeting.title || "Google Meet call"),
        })

        if (result.success) {
            setFinalMessage(SUCCESS_MESSAGE[result.mode])
            return
        }

        setFinalMessage(result.message.errorMessage)
        setRetryable(result.retryable)
    }

    function runAndReportErrors() {
        run().catch((err) => {
            console.error("[obsidian-handoff] flow failed", err)
            setFinalMessage(`Something went wrong: ${err && err.message ? err.message : String(err)}`)
        })
    }

    useEffect(() => {
        // React 18/19 StrictMode double-invokes effects in dev — this page only ever runs
        // in a real built extension tab, but guard anyway since this flow has real
        // side effects (clipboard writes, navigation) that must only run once on mount.
        // A user-initiated Retry click (see handleRetry below) is a separate, deliberate
        // re-invocation and isn't gated by this ref.
        if (ranOnce.current) return
        ranOnce.current = true
        runAndReportErrors()
    }, [])

    function handleRetry() {
        runAndReportErrors()
    }

    return (
        <div className="mx-auto max-w-xl p-10">
            <h1 className="mb-4 text-2xl font-bold">Save to Obsidian</h1>
            <div className="bg-muted/40 rounded-lg p-6">
                <div className="mb-4 font-bold">{meetingTitle}</div>

                <ol className="mb-4 flex flex-col gap-2">
                    {steps.map((step) => (
                        <li key={step.id} className="flex items-center justify-between gap-4 text-sm">
                            <span>{step.label}</span>
                            <span className="flex items-center gap-2">
                                {step.detail ? <span className="text-muted-foreground text-xs">{step.detail}</span> : null}
                                <span className={`rounded px-2 py-0.5 text-xs font-bold ${statusStyles[step.status]}`}>
                                    {statusLabels[step.status]}
                                </span>
                            </span>
                        </li>
                    ))}
                </ol>

                <p className="mb-4 leading-relaxed">{finalMessage}</p>

                <div className="flex items-center gap-2">
                    {retryable ? (
                        <Button type="button" onClick={handleRetry}>
                            Retry
                        </Button>
                    ) : null}
                    <Button type="button" variant={retryable ? "outline" : "default"} onClick={() => window.close()}>
                        Close this tab
                    </Button>
                </div>

                <p className="text-muted-foreground mt-6 text-xs">
                    If Chrome asks "Open Obsidian?", click Allow (and "Always allow" to skip this prompt for future
                    meetings). This prompt is tab-modal — closing this tab before answering it will dismiss the
                    prompt without opening Obsidian.
                </p>
            </div>
        </div>
    )
}
