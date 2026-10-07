import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { askTranscriptQuestion } from "../../../extension/obsidian/transcript-chat.js"
import ContextExceededDialog from "./ContextExceededDialog"

interface TranscriptChatTabProps {
    meeting: Meeting
    onSessionChange: (messages: TranscriptChatMessage[]) => void
}

const STARTER_QUESTIONS = ["What were the key decisions?", "What do I need to follow up on?", "Summarize the main points."]

function newMessage(role: TranscriptChatMessage["role"], content: string): TranscriptChatMessage {
    return {
        id: crypto.randomUUID(),
        role,
        content,
        createdAt: new Date().toISOString(),
    }
}

export default function TranscriptChatTab({ meeting, onSessionChange }: TranscriptChatTabProps) {
    const messages = meeting.transcriptChatMessages || []
    const [draft, setDraft] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [isSending, setIsSending] = useState(false)
    const [contextDialog, setContextDialog] = useState<{ requiredTokens: number; loadedContextLength?: number } | null>(
        null,
    )
    const controllerRef = useRef<AbortController | null>(null)
    const endRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
    }, [messages.length, isSending])

    useEffect(() => () => controllerRef.current?.abort(), [])

    async function requestAnswer(nextMessages: TranscriptChatMessage[]) {
        setError(null)
        setIsSending(true)

        const controller = new AbortController()
        controllerRef.current = controller
        const result = await askTranscriptQuestion(meeting, nextMessages, controller.signal)
        if (controllerRef.current !== controller) return
        controllerRef.current = null
        setIsSending(false)

        if (result.success) {
            onSessionChange([...nextMessages, newMessage("assistant", result.answer)])
            return
        }
        if (result.reason === "context-exceeded") {
            setContextDialog({
                requiredTokens: result.requiredTokens,
                loadedContextLength: result.loadedContextLength,
            })
        } else if (result.reason === "not-configured") {
            setError("Select an AI provider and model in Integrations first.")
        } else if (result.reason === "request-failed") {
            setError("AI could not answer. Check the provider connection and try again.")
        }
    }

    async function sendQuestion(question = draft) {
        const content = question.trim()
        if (!content || isSending || meeting.transcript.length === 0) return

        const userMessage = newMessage("user", content)
        const nextMessages = [...messages, userMessage]
        onSessionChange(nextMessages)
        setDraft("")
        await requestAnswer(nextMessages)
    }

    function clearSession() {
        controllerRef.current?.abort()
        controllerRef.current = null
        setIsSending(false)
        setDraft("")
        setError(null)
        onSessionChange([])
    }

    return (
        <div className="flex min-h-[460px] flex-col">
            <div className="flex items-center justify-between border-b border-meetings-border px-4 py-3">
                <div>
                    <p className="font-meetings-heading text-sm font-medium text-meetings-ink">Ask about this meeting</p>
                    <p className="text-xs text-meetings-ink-muted">Answers use the transcript as their source.</p>
                </div>
                <Button variant="ghost" size="sm" disabled={messages.length === 0 && !isSending} onClick={clearSession}>
                    Clear session
                </Button>
            </div>

            <div className="flex flex-1 flex-col gap-4 px-4 py-4">
                {messages.length === 0 ? (
                    <div className="my-auto flex flex-col items-center gap-3 py-8 text-center">
                        <p className="max-w-sm text-sm text-meetings-ink-muted">
                            Ask for decisions, action items, details, or anything else discussed in the transcript.
                        </p>
                        <div className="flex flex-wrap justify-center gap-2">
                            {STARTER_QUESTIONS.map((question) => (
                                <button
                                    key={question}
                                    type="button"
                                    disabled={meeting.transcript.length === 0}
                                    onClick={() => sendQuestion(question)}
                                    className="rounded-full border border-meetings-border bg-meetings-surface px-3 py-1.5 text-xs text-meetings-ink transition-colors hover:bg-meetings-chip disabled:pointer-events-none disabled:opacity-50"
                                >
                                    {question}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col gap-4" aria-live="polite">
                        {messages.map((message) => (
                            <div
                                key={message.id}
                                className={message.role === "user" ? "ml-auto max-w-[85%]" : "mr-auto max-w-[90%]"}
                            >
                                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-meetings-ink-faint">
                                    {message.role === "user" ? "You" : "AI"}
                                </p>
                                <div
                                    className={
                                        "whitespace-pre-wrap rounded-xl px-3 py-2 text-sm " +
                                        (message.role === "user"
                                            ? "bg-meetings-accent text-white"
                                            : "border border-meetings-border bg-meetings-surface text-meetings-ink")
                                    }
                                >
                                    {message.content}
                                </div>
                            </div>
                        ))}
                        {isSending ? (
                            <div className="mr-auto rounded-xl border border-meetings-border bg-meetings-surface px-3 py-2 text-sm text-meetings-ink-muted">
                                Reading the transcript…
                            </div>
                        ) : null}
                        <div ref={endRef} />
                    </div>
                )}

                <div className="mt-auto border-t border-meetings-border pt-4">
                    {error ? <p className="mb-2 text-xs text-destructive">{error}</p> : null}
                    <div className="flex items-end gap-2">
                        <Textarea
                            value={draft}
                            disabled={isSending || meeting.transcript.length === 0}
                            onChange={(event) => setDraft(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" && !event.shiftKey) {
                                    event.preventDefault()
                                    sendQuestion()
                                }
                            }}
                            placeholder={meeting.transcript.length === 0 ? "No transcript available" : "Ask a question…"}
                            className="max-h-36 min-h-10 resize-none rounded-xl border-meetings-border text-sm"
                        />
                        {isSending ? (
                            <Button variant="outline" onClick={() => controllerRef.current?.abort()}>
                                Stop
                            </Button>
                        ) : (
                            <Button disabled={!draft.trim() || meeting.transcript.length === 0} onClick={() => sendQuestion()}>
                                Send
                            </Button>
                        )}
                    </div>
                    <p className="mt-2 text-[10px] text-meetings-ink-faint">AI can make mistakes. Verify important details in Transcript.</p>
                </div>
            </div>

            {contextDialog ? (
                <ContextExceededDialog
                    open
                    requiredTokens={contextDialog.requiredTokens}
                    loadedContextLength={contextDialog.loadedContextLength}
                    onOpenChange={(open) => !open && setContextDialog(null)}
                    onRetry={() => requestAnswer(messages)}
                />
            ) : null}
        </div>
    )
}
