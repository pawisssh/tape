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
    pending: "text-meetings-ink-faint",
    active: "text-meetings-accent",
    done: "text-meetings-ink",
    skipped: "text-meetings-ink-faint",
    failed: "text-destructive",
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
        <div className="meetings-redesign mx-auto max-w-xl p-10">
            <h1 className="font-meetings-heading mb-4 text-2xl text-meetings-ink">Save to Obsidian</h1>
            <div className="border border-meetings-border p-6">
                <div className="mb-4 font-bold text-meetings-ink">{meetingTitle}</div>

                <ol className="mb-4 flex flex-col gap-2">
                    {steps.map((step) => (
                        <li key={step.id} className="flex items-center justify-between gap-4 text-sm">
                            <span className="text-meetings-ink">{step.label}</span>
                            <span className="flex items-center gap-2">
                                {step.detail ? <span className="text-xs text-meetings-ink-muted">{step.detail}</span> : null}
                                <span
                                    className={`font-meetings-mono text-[10px] font-medium tracking-wide uppercase ${statusStyles[step.status]}`}
                                >
                                    {statusLabels[step.status]}
                                </span>
                            </span>
                        </li>
                    ))}
                </ol>

                <p className="mb-4 leading-relaxed text-meetings-ink">{finalMessage}</p>

                <div className="flex items-center gap-2">
                    {retryable ? (
                        <Button type="button" className="rounded-none" onClick={handleRetry}>
                            Retry
                        </Button>
                    ) : null}
                    <Button
                        type="button"
                        variant={retryable ? "outline" : "default"}
                        className="rounded-none"
                        onClick={() => window.close()}
                    >
                        Close this tab
                    </Button>
                </div>

                <p className="mt-6 text-xs text-meetings-ink-muted">
                    If Chrome asks "Open Obsidian?", click Allow (and "Always allow" to skip this prompt for future
                    meetings). This prompt is tab-modal — closing this tab before answering it will dismiss the
                    prompt without opening Obsidian.
                </p>
            </div>
        </div>
    )
}
