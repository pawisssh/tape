import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"

// Framework-free logic modules, imported directly — never duplicated into src/. See
// PLAN.md §6 Phase 5 "Structural rule to preserve".
import { buildMarkdown, buildFilename } from "../../extension/obsidian/markdown.js"
import { buildObsidianUri, joinObsidianPath } from "../../extension/obsidian/uri.js"
import { enrichWithLlm } from "../../extension/obsidian/llm.js"
import {
    getMeetingById,
    updateMeetingById,
    getObsidianSettings,
    acquireClipboardLock,
    releaseClipboardLock,
} from "../../extension/obsidian/store.js"

type StepStatus = "pending" | "active" | "done" | "skipped" | "failed"

type StepId = "load" | "markdown" | "llm" | "deliver" | "launch"

interface StepState {
    id: StepId
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

export default function App() {
    const [meetingTitle, setMeetingTitle] = useState("Loading meeting…")
    const [steps, setSteps] = useState<StepState[]>(INITIAL_STEPS)
    const [finalMessage, setFinalMessage] = useState("Starting…")
    const ranOnce = useRef(false)

    function patchStep(id: StepId, patch: Partial<StepState>) {
        setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
    }

    useEffect(() => {
        // React 18/19 StrictMode double-invokes effects in dev — this page only ever runs
        // in a real built extension tab, but guard anyway since this flow has real
        // side effects (clipboard writes, navigation) that must only run once.
        if (ranOnce.current) return
        ranOnce.current = true

        async function run() {
            const params = new URLSearchParams(window.location.search)
            const meetingId = params.get("meetingId")

            if (!meetingId) {
                patchStep("load", { status: "failed", detail: "No meetingId in the URL." })
                setFinalMessage("This page must be opened with a meetingId parameter.")
                return
            }

            patchStep("load", { status: "active" })
            const [meeting, settings] = await Promise.all([getMeetingById(meetingId), getObsidianSettings()])

            if (!meeting) {
                patchStep("load", { status: "failed", detail: "Meeting not found." })
                setFinalMessage("Meeting not found — it may have been deleted from history.")
                return
            }

            setMeetingTitle(meeting.meetingTitle || meeting.title || "Google Meet call")
            patchStep("load", { status: "done" })

            if (!settings.obsidianVaultName) {
                patchStep("markdown", { status: "skipped" })
                patchStep("llm", { status: "skipped" })
                patchStep("deliver", { status: "skipped" })
                patchStep("launch", { status: "failed", detail: "No Obsidian vault configured." })
                setFinalMessage("No Obsidian vault configured. Go to the meetings page and set a vault name first.")
                await markStatus(meetingId, "failed")
                return
            }

            // Optional local LLM enrichment (Phase 4). enrichWithLlm() is documented to
            // NEVER throw and to resolve to `null` on any failure whatsoever — null just
            // means "skip enrichment". The try/catch here is deliberate defense-in-depth
            // on top of that guarantee (see PLAN.md §8), so an unforeseen bug in llm.js
            // can never take down the plain-transcript export path.
            let llmResult: { title?: string; summaryMarkdown: string } | null = null
            if (settings.obsidianUseLlm) {
                patchStep("llm", { status: "active" })
                try {
                    llmResult = await enrichWithLlm(meeting, settings)
                } catch (err) {
                    console.error("[obsidian-handoff] LLM enrichment threw unexpectedly (falling back to plain note)", err)
                    llmResult = null
                }
                if (llmResult) {
                    patchStep("llm", { status: "done" })
                    await markSummaryCache(meetingId, llmResult)
                } else {
                    patchStep("llm", {
                        status: "skipped",
                        detail: "Local LLM unavailable or returned nothing usable — continuing with the plain transcript.",
                    })
                }
            } else {
                patchStep("llm", { status: "skipped", detail: "Local LLM summary enrichment is off." })
            }

            patchStep("markdown", { status: "active" })
            const content = buildMarkdown(
                meeting,
                llmResult ? { overrideTitle: llmResult.title, summaryMarkdown: llmResult.summaryMarkdown } : undefined,
            )
            const filename = buildFilename(settings.obsidianFileNameTemplate, meeting)
            const filePath = joinObsidianPath(settings.obsidianFolder, filename)
            const built = buildObsidianUri({ vault: settings.obsidianVaultName, filePath, content })
            patchStep("markdown", { status: "done" })

            if (built.mode === "clipboard") {
                patchStep("deliver", { status: "active", detail: "Copying to clipboard…" })
                const locked = await acquireClipboardLock()
                if (!locked) {
                    patchStep("deliver", {
                        status: "failed",
                        detail: "Another Obsidian export is already in progress.",
                    })
                    patchStep("launch", { status: "skipped" })
                    setFinalMessage(
                        'Another Obsidian export is already in progress. Please retry "Save to Obsidian" for this meeting in a few seconds.',
                    )
                    await markStatus(meetingId, "failed")
                    return
                }

                // The handoff tab is opened via chrome.tabs.create() right as a Meet call
                // ends, and the browser doesn't always bring it (or its window) into focus
                // immediately — navigator.clipboard.writeText() throws a NotAllowedError/
                // DOMException in an unfocused document. Force focus first (best-effort,
                // non-fatal), then still fall back to the legacy execCommand("copy")
                // technique if the Clipboard API attempt fails anyway.
                await focusThisWindow()

                const clipboardText = built.content ?? content
                let copied = false
                try {
                    await navigator.clipboard.writeText(clipboardText)
                    copied = true
                } catch (err) {
                    console.error(
                        "[obsidian-handoff] clipboard write failed, trying document.execCommand('copy') fallback",
                        err,
                    )
                    patchStep("deliver", { status: "active", detail: "Retrying copy…" })
                    try {
                        copied = copyViaExecCommand(clipboardText)
                        if (!copied) {
                            console.error("[obsidian-handoff] execCommand('copy') fallback returned false")
                        }
                    } catch (fallbackErr) {
                        console.error("[obsidian-handoff] execCommand('copy') fallback threw", fallbackErr)
                    }
                }

                if (!copied) {
                    patchStep("deliver", { status: "failed", detail: "Could not copy the note to the clipboard." })
                    patchStep("launch", { status: "skipped" })
                    setFinalMessage('Could not copy the note to the clipboard. Please retry "Save to Obsidian" for this meeting.')
                    await markStatus(meetingId, "failed")
                    await releaseClipboardLock()
                    return
                }
                patchStep("deliver", { status: "done" })
            } else {
                patchStep("deliver", { status: "skipped", detail: "Note is short enough to send inline." })
            }

            patchStep("launch", { status: "active" })
            await markStatus(meetingId, "handed_off")

            // Navigate this tab itself (not window.open) so Chrome's native "Open
            // Obsidian?" confirmation has a real, focused tab to attach to.
            window.location.href = built.uri

            if (built.mode === "clipboard") {
                // Give the OS/Obsidian a moment to actually read the clipboard before
                // releasing the lock — see the TTL/race caveat documented in store.js.
                setTimeout(() => {
                    releaseClipboardLock()
                }, 5000)
            }

            patchStep("launch", { status: "done" })
            setFinalMessage(
                built.mode === "clipboard"
                    ? 'Copied to clipboard. Opening Obsidian — if the note body is empty, paste with Cmd/Ctrl+V.'
                    : "Opening Obsidian…",
            )
        }

        run().catch((err) => {
            console.error("[obsidian-handoff] flow failed", err)
            setFinalMessage(`Something went wrong: ${err && err.message ? err.message : String(err)}`)
        })
    }, [])

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

                <Button type="button" onClick={() => window.close()}>
                    Close this tab
                </Button>

                <p className="text-muted-foreground mt-6 text-xs">
                    If Chrome asks "Open Obsidian?", click Allow (and "Always allow" to skip this prompt for future
                    meetings). This prompt is tab-modal — closing this tab before answering it will dismiss the
                    prompt without opening Obsidian.
                </p>
            </div>
        </div>
    )
}

// Best-effort attempt to bring this tab's window into focus before writing to the
// clipboard. navigator.clipboard.writeText() requires document focus, and the handoff
// tab is opened programmatically (chrome.tabs.create()) right as a Meet call ends, so
// the browser doesn't always focus it (or its window) immediately. Never let a failure
// here (e.g. missing "windows" permission, already focused, etc.) block the flow.
async function focusThisWindow() {
    try {
        const win = await chrome.windows.getCurrent()
        if (win.id !== undefined && win.id !== chrome.windows.WINDOW_ID_NONE) {
            await chrome.windows.update(win.id, { focused: true })
        }
        // Give the browser a beat to actually apply focus before the clipboard write.
        await new Promise((resolve) => setTimeout(resolve, 150))
    } catch (err) {
        console.warn("[obsidian-handoff] could not force window focus (continuing anyway)", err)
    }
}

// Legacy fallback for when the async Clipboard API throws (typically a NotAllowedError
// DOMException because the document isn't focused). Uses a hidden, off-screen
// (not display:none — execCommand needs the element rendered/selectable) textarea.
function copyViaExecCommand(text: string): boolean {
    const textarea = document.createElement("textarea")
    textarea.value = text
    textarea.setAttribute("readonly", "")
    textarea.style.position = "fixed"
    textarea.style.top = "0"
    textarea.style.left = "-9999px"
    textarea.style.opacity = "0"
    document.body.appendChild(textarea)
    try {
        textarea.focus()
        textarea.select()
        textarea.setSelectionRange(0, textarea.value.length)
        return document.execCommand("copy")
    } finally {
        document.body.removeChild(textarea)
    }
}

async function markStatus(meetingId: string, status: ObsidianSaveStatus) {
    try {
        await updateMeetingById(meetingId, () => ({ obsidianSaveStatus: status }))
    } catch (err) {
        // Non-fatal: the handoff itself may have already succeeded (or failed) by the
        // time this bookkeeping write fails. Never let this throw block the flow.
        console.error("[obsidian-handoff] failed to update meeting status", err)
    }
}

async function markSummaryCache(meetingId: string, llmResult: { title?: string; summaryMarkdown: string }) {
    try {
        await updateMeetingById(meetingId, () => ({
            llmSummaryMarkdown: llmResult.summaryMarkdown,
            ...(llmResult.title ? { llmSummaryTitle: llmResult.title } : {}),
        }))
    } catch (err) {
        console.error("[obsidian-handoff] failed to cache LLM summary (non-fatal)", err)
    }
}
