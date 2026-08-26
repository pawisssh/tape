// React rewrite of the legacy extension/side-panel/side-panel.js. Preserves the exact
// wire contract the rest of the extension depends on: chrome.storage.local's
// "meetingTitle"/"transcript" keys, and the "broadcast_live_buffer" runtime message
// carrying the in-progress `stateTranscriptBlock` (content script -> side panel, see
// types/index.js's ExtensionMessage). Only the rendering changed.
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { getLocal, onStorageChanged, setLocal } from "@/lib/chrome-storage"

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
                <span className="text-muted-foreground flex items-center gap-1.5">
                    {personName}
                    {isLive ? (
                        <span aria-hidden className="bg-primary inline-block size-1.5 animate-pulse rounded-full" />
                    ) : null}
                </span>
                <span className="text-muted-foreground">{timeString}</span>
            </div>
            <p className={`text-sm leading-relaxed break-words ${isLive ? "text-foreground/70 italic" : ""}`}>
                {text}
            </p>
        </div>
    )
}

export default function App() {
    const [meetingTitle, setMeetingTitle] = useState("Live Meeting Transcript")
    const [transcript, setTranscript] = useState<TranscriptBlock[]>([])
    const [liveBlock, setLiveBlock] = useState<StateTranscriptBlock | null>(null)

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
        <div className="dark bg-background text-foreground flex h-screen flex-col">
            <div className="bg-sidebar border-sidebar-border border-b px-4 py-3">
                <h1
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={handleTitleBlur}
                    onKeyDown={handleTitleKeyDown}
                    className="rounded p-0.5 text-sm font-bold outline-none hover:outline hover:outline-muted-foreground"
                >
                    {meetingTitle}
                </h1>
            </div>

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
    )
}
