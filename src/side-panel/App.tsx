// React rewrite of the legacy extension/side-panel/side-panel.js. Preserves the exact
// wire contract the rest of the extension depends on: chrome.storage.local's
// "meetingTitle"/"transcript" keys, and the "broadcast_live_buffer" runtime message
// carrying the in-progress `stateTranscriptBlock` (content script -> side panel, see
// types/index.js's ExtensionMessage). Only the rendering changed.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { getLocal, onStorageChanged, setLocal } from "@/lib/chrome-storage"

import { useLiveCaptureState } from "@/meetings/use-live-capture-state"

const SCROLL_THRESHOLD = 50

function TranscriptBlockItem({
    personName,
    timestamp,
    text,
    isLive,
}: {
    personName: string
    timestamp: string
    text: string
    isLive?: boolean
}) {
    const timeString = timestamp
        ? new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : ""

    return (
        <div className="mb-5">
            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-1.5 text-white/38">
                    {personName}
                    {isLive ? (
                        <span aria-hidden className="bg-meetings-accent inline-block size-1.5 animate-pulse" />
                    ) : null}
                </span>
                <span className="text-white/38">{timeString}</span>
            </div>
            <p className={`text-sm leading-relaxed break-words text-white ${isLive ? "text-white/70 italic" : ""}`}>
                {text}
            </p>
        </div>
    )
}

export default function App() {
    const [meetingTitle, setMeetingTitle] = useState("Live Meeting Transcript")
    const [transcript, setTranscript] = useState<TranscriptBlock[]>([])
    const [liveBlock, setLiveBlock] = useState<StateTranscriptBlock | null>(null)

    const { isCapturing } = useLiveCaptureState()
    const [assist, setAssist] = useState<{ mode: "rewind" | "recap"; text: string; raw?: string; error?: boolean; model?: string; capturedAt?: string; progress?: string } | null>(null)
    const [busy, setBusy] = useState(false)
    const busyRef = useRef(false)
    const requestRef = useRef(0)
    const runAssist = useCallback(async (mode: "rewind" | "recap") => {
        if (busyRef.current) return
        busyRef.current = true
        setBusy(true)
        setAssist({ mode, text: mode === "rewind" ? "Recalling the last 15 seconds…" : "Summarizing the meeting so far…" })
        const request = ++requestRef.current
        try {
            if (mode === "rewind") {
                const preview: ExtensionResponse = await chrome.runtime.sendMessage({ type: "live_assist_preview", mode })
                if (request !== requestRef.current) return
                if (preview.success && typeof preview.message === "string") {
                    setAssist(current => current?.mode === mode ? { ...current, raw: preview.message as string } : current)
                }
            }
            const response: ExtensionResponse = await chrome.runtime.sendMessage({ type: "live_assist", mode })
            if (request !== requestRef.current) return
            setAssist(current => ({ mode, raw: current?.mode === mode ? current.raw : undefined, text: typeof response?.message === "string" ? response.message : "AI could not generate a response. Try again.", error: !response?.success, model: response?.model, capturedAt: response?.capturedAt, progress: response?.progress }))
        } catch {
            if (request === requestRef.current) setAssist({ mode, text: "Could not reach the extension. Try again.", error: true })
        } finally {
            if (request === requestRef.current) {
                busyRef.current = false
                setBusy(false)
            }
        }
    }, [])

    useEffect(() => {
        return onStorageChanged((changes, area) => {
            if (area === "local" && changes.meetingStartTimestamp) {
                requestRef.current++
                busyRef.current = false
                setBusy(false)
                setAssist(null)
                setLiveBlock(null)
            }
        })
    }, [runAssist])

    const containerRef = useRef<HTMLDivElement>(null)
    const stickToBottomRef = useRef(false)

    function isUserAtBottom() {
        const el = containerRef.current
        if (!el) return true
        return el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_THRESHOLD
    }

    useEffect(() => {
        getLocal<ResultLocal>(["meetingTitle", "transcript"]).then((result) => {
            if (result.meetingTitle) {
                setMeetingTitle(result.meetingTitle)
            }
            if (result.transcript) {
                setTranscript(result.transcript)
            }
        })

        const unsubscribeStorage = onStorageChanged((changes, areaName) => {
            if (areaName !== "local") return

            if (changes.meetingTitle?.newValue) {
                setMeetingTitle(changes.meetingTitle.newValue)
            }

            if (changes.transcript) {
                stickToBottomRef.current = isUserAtBottom()
                setTranscript(changes.transcript.newValue || [])
                setLiveBlock(null)
            }
        })

        function onMessage(messageUnTyped: unknown) {
            const message = messageUnTyped as ExtensionMessage
            if (message.type === "broadcast_live_buffer" && message.stateTranscriptBlock) {
                if (!message.stateTranscriptBlock.transcriptTextBuffer.trim()) return
                stickToBottomRef.current = isUserAtBottom()
                setLiveBlock(message.stateTranscriptBlock)
            }
        }
        chrome.runtime.onMessage.addListener(onMessage)

        return () => {
            unsubscribeStorage()
            chrome.runtime.onMessage.removeListener(onMessage)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useLayoutEffect(() => {
        if (stickToBottomRef.current && containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight
        }
        stickToBottomRef.current = false
    }, [transcript, liveBlock])

    function handleTitleBlur(e: React.FocusEvent<HTMLHeadingElement>) {
        const titleText = e.currentTarget.innerText.trim()
        setLocal({ meetingTitle: titleText })
    }

    function handleTitleKeyDown(e: React.KeyboardEvent<HTMLHeadingElement>) {
        if (e.key === "Enter") {
            e.preventDefault()
            e.currentTarget.blur()
        }
    }

    return (
        // `meetings-redesign` and `bg-black` are deliberately on separate elements, not
        // combined on one div: `.meetings-redesign` (globals.css) sets its own
        // `background-color: #f6f6f6` as a plain unlayered CSS rule, which — per the CSS
        // cascade-layers spec — always wins over a Tailwind utility class like `bg-black`
        // (emitted inside `@layer utilities`) regardless of className order, so putting
        // both on the same element would silently render #f6f6f6 instead of black. The
        // outer div only needs `meetings-redesign` for font-family inheritance (needed by
        // `font-meetings-heading` below, which resolves via a `.meetings-redesign
        // .font-meetings-heading` descendant selector) — its own background never shows
        // since the inner div fully covers it. Same split App.tsx already uses for
        // SidebarStatusBar.tsx's bg-black.
        <div className="meetings-redesign dark h-screen">
            <div className="flex h-full flex-col bg-black text-white">
                <div className="border-b border-white/12 px-4 py-3">
                    <h1
                        contentEditable
                        suppressContentEditableWarning
                        onBlur={handleTitleBlur}
                        onKeyDown={handleTitleKeyDown}
                        className="font-meetings-heading rounded-none p-0.5 text-sm outline-none hover:outline hover:outline-white/24"
                    >
                        {meetingTitle}
                    </h1>
                </div>

                <div className="border-b border-white/12 px-4 py-3">
                    <div className="flex gap-2">
                        <button type="button" disabled={!isCapturing || busy} onClick={() => void runAssist("rewind")} className="inline-flex items-center gap-1.5 rounded border border-white/25 px-3 py-2 text-sm disabled:opacity-40" title="Recall captions received in the last 15 seconds"><img src={chrome.runtime.getURL("extension/fab-rewind-icon.svg")} alt="" className="size-5 invert" />Rewind · 15s</button>
                        <button type="button" disabled={!isCapturing || busy} onClick={() => void runAssist("recap")} className="inline-flex items-center gap-1.5 rounded border border-white/25 px-3 py-2 text-sm disabled:opacity-40" title="Summarize from the start of the meeting up to now"><img src={chrome.runtime.getURL("extension/fab-recap-icon.svg")} alt="" className="size-5 invert" />Recap</button>
                    </div>
                    {!isCapturing ? <p className="mt-2 text-xs text-white/50">Start meeting capture to use Rewind and Recap.</p> : null}
                </div>
                {assist ? (
                    <section aria-live="polite" aria-busy={busy} className="max-h-[45vh] overflow-y-auto border-b border-white/12 bg-white/5 p-4">
                        <div className="mb-2 flex items-center justify-between">
                            <h2 className="text-sm font-semibold">{assist.mode === "rewind" ? "Rewind · Last 15 seconds" : "Recap · Meeting so far"}</h2>
                            {!busy ? <button type="button" aria-label="Dismiss AI result" onClick={() => setAssist(null)} className="text-xs text-white/60">Dismiss</button> : null}
                        </div>
                        {assist.raw ? <div className="mb-3 rounded bg-white/8 p-2"><p className="mb-1 text-xs text-white/50">Captured captions</p><p className="whitespace-pre-wrap break-words text-sm">{assist.raw}</p></div> : null}
                        <p className={`whitespace-pre-wrap break-words text-sm leading-relaxed ${assist.error ? "text-red-300" : "text-white/90"}`}>{assist.text}</p>
                        {assist.progress ? <p className="mt-3 text-xs text-amber-200">{assist.progress}</p> : assist.model ? <p className="mt-3 text-xs text-white/45">{assist.model} · Through {assist.capturedAt ? new Date(assist.capturedAt).toLocaleTimeString() : "now"}</p> : null}
                    </section>
                ) : null}

                <div ref={containerRef} className="flex-1 overflow-y-auto p-4">
                    {transcript.map((block, i) => (
                        <TranscriptBlockItem
                            key={i}
                            personName={block.personName}
                            timestamp={block.timestamp}
                            text={block.transcriptText}
                        />
                    ))}
                    {liveBlock ? (
                        <TranscriptBlockItem
                            personName={liveBlock.personName}
                            timestamp={liveBlock.timestamp}
                            text={liveBlock.transcriptTextBuffer}
                            isLive
                        />
                    ) : null}
                </div>
            </div>
        </div>
    )
}
