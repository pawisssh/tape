import { useEffect, useRef, useState } from "react"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { asErrorObject, sendMessage } from "@/lib/messaging"
import { writeTextWithFallback } from "@/lib/clipboard"
import { getTranscriptString, getChatMessagesString } from "../../../extension/background-script/utils.js"
// Framework-free logic module, imported directly — never duplicated into src/, same
// pattern MeetingDetail.tsx already uses for save-flow.js's runSaveToObsidianFlow. Called
// directly (not via chrome.runtime.sendMessage to the background service worker) because
// Chrome kills any single in-flight network request from a service worker after 5
// minutes regardless of the configured obsidianLlmTimeoutMs — see summarize-now.js's own
// header comment for the full rationale.
import { summarizeNow } from "../../../extension/obsidian/summarize-now.js"
import CircleIconButton from "../ui/CircleIconButton"
import { ChatBubbleIcon, ContentCopyIcon, DownloadIcon, MoreHorizIcon, WebhookIcon, DeleteIcon } from "../ui/icons"
import FollowUpTemplatePicker from "./FollowUpTemplatePicker"
import ContextExceededDialog from "./ContextExceededDialog"

interface MeetingDetailToolbarProps {
    meeting: Meeting
    index: number
    onDeleted: (index: number) => void
    onChanged: () => void
    onTemplateOverrideChange: (templateOverrideId: string | undefined) => Promise<void>
    // Lifted to MeetingsView.tsx (shared with MeetingDetail.tsx's Run flow) and keyed by
    // meeting id — see MeetingDetail.tsx's own doc comment on this same prop pair.
    operation: MeetingOperation | null
    onOperationChange: (operation: MeetingOperation | null) => void
    // Registers/clears this component's own cancel function while regenerateSummary is in
    // flight, so the sticky status bar's Stop button (rendered in MeetingDetail.tsx's
    // DetailTabs, a sibling component) can reach it — see MeetingsView.tsx's own comment
    // on its cancelHandlersRef.
    onRegisterCancel: (meetingId: string, fn: (() => void) | null) => void
    onOpenChat: () => void
}

// Rendered in MeetingsView.tsx's `detailTitle` slot — MasterDetailLayout's sticky h-16
// header row — so this sits ABOVE the title/stats (which live in MeetingDetail.tsx's
// scrollable body), matching Figma's node 1:176 "Toolbar": a Leading region (the
// Follow-up template picker) and a Trailing region (Copy/Download/More-actions), with the
// title+stats block (1:178) starting fresh below it. Split out of MeetingDetail.tsx
// specifically so the two pieces can occupy MasterDetailLayout's two separate DOM slots
// (detailTitle vs. detail) — MasterDetailLayout offers no other way to interleave content
// between them.
export default function MeetingDetailToolbar({
    meeting,
    index,
    onDeleted,
    onChanged,
    onTemplateOverrideChange,
    operation,
    onOperationChange,
    onRegisterCancel,
    onOpenChat,
}: MeetingDetailToolbarProps) {
    const [isPostingWebhook, setIsPostingWebhook] = useState(false)
    const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
    const [contextDialog, setContextDialog] = useState<{ requiredTokens: number; loadedContextLength?: number } | null>(
        null,
    )

    // Stable id — must match extension/obsidian/store.js's getMeetingId().
    const meetingId = meeting.meetingStartTimestamp
    const busy = operation?.meetingId === meetingId

    // This component remounts per-meeting (see MeetingsView.tsx's `key={...meetingId}`).
    // summarizeNow() now runs directly in this page's own context (not the background
    // service worker), so — same as Run — closing/navigating away from this tab does stop
    // it; this guard is for the case where the meeting is simply switched while it's still
    // running, so a late resolution can't clobber a different meeting's state. See
    // MeetingDetail.tsx's identical guard on its Run flow for the full rationale.
    const isMountedRef = useRef(true)
    useEffect(() => {
        isMountedRef.current = true
        return () => {
            isMountedRef.current = false
        }
    }, [])

    function handleDownload() {
        sendMessage({ type: "download_transcript_at_index", index }).then((response) => {
            if (!response.success) {
                toast.add({ title: "Could not download transcript", type: "error" })
                const parsedError = asErrorObject(response.message)
                if (parsedError) {
                    console.error(parsedError.errorMessage)
                }
            }
        })
    }

    async function handleCopyTranscript() {
        const text = getTranscriptString(meeting.transcript) + getChatMessagesString(meeting.chatMessages)
        if (!text.trim()) {
            toast.add({ title: "Nothing to copy", description: "This meeting has no transcript.", type: "warning" })
            return
        }
        const copied = await writeTextWithFallback(text)
        toast.add(copied ? { title: "Transcript copied", type: "success" } : { title: "Could not copy transcript", type: "error" })
    }

    function handleWebhookPost() {
        setIsPostingWebhook(true)
        sendMessage({ type: "post_webhook_at_index", index }).then((response) => {
            setIsPostingWebhook(false)
            onChanged()
            if (response.success) {
                toast.add({ title: "Webhook posted", type: "success" })
            } else {
                toast.add({ title: "Could not post webhook", type: "error" })
                const parsedError = asErrorObject(response.message)
                if (parsedError) {
                    console.error(parsedError.errorMessage)
                }
            }
        })
    }

    // Triggered by the Follow-up template picker (picking a different template
    // regenerates immediately — see handleTemplatePickerChange below); the single place
    // that drives the sticky status bar and calls summarizeNow() directly.
    async function regenerateSummary() {
        const controller = new AbortController()
        onOperationChange({ meetingId, label: "Summarizing…" })
        onRegisterCancel(meetingId, () => controller.abort())
        const response = await summarizeNow(meetingId, controller.signal)
        onRegisterCancel(meetingId, null)
        if (isMountedRef.current) onOperationChange(null)
        onChanged()
        if (response.success) {
            toast.add({ title: "Summary ready", type: "success" })
        } else if (response.contextExceeded) {
            if (isMountedRef.current) setContextDialog(response.contextExceeded)
        } else if (response.stopped) {
            toast.add({ title: "Stopped", type: "warning" })
        } else {
            toast.add({
                title: "Could not summarize",
                description: typeof response.message === "string" ? response.message : undefined,
                type: "error",
            })
        }
    }

    async function handleTemplatePickerChange(templateOverrideId: string | undefined) {
        // Must land in storage before regenerating — enrichWithLlm() (background) reads
        // meeting.templateOverrideId from storage, so a fresh read has to see the new value.
        await onTemplateOverrideChange(templateOverrideId)
        await regenerateSummary()
    }

    function handleConfirmDelete() {
        setConfirmDeleteOpen(false)
        onDeleted(index)
    }

    return (
        <div className="flex flex-1 items-center justify-between gap-2">
            <FollowUpTemplatePicker value={meeting.templateOverrideId} disabled={busy} onChange={handleTemplatePickerChange} />

            <div className="flex items-center gap-2">
                <div className="flex h-9 items-center gap-0 rounded-full bg-meetings-card shadow-[0px_16px_16px_rgba(12,12,13,0.1),0px_4px_2px_rgba(12,12,13,0.05)]">
                    <CircleIconButton bare label="Copy transcript" icon={<ContentCopyIcon />} onClick={handleCopyTranscript} />
                    <CircleIconButton bare label="Download transcript" icon={<DownloadIcon />} onClick={handleDownload} />
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger render={<CircleIconButton label="More actions" icon={<MoreHorizIcon />} />} />
                    <DropdownMenuContent align="start">
                        <DropdownMenuItem onClick={onOpenChat}>
                            <ChatBubbleIcon className="size-4" /> Chat with AI
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={isPostingWebhook} onClick={handleWebhookPost}>
                            <WebhookIcon className="size-4" />
                            {meeting.webhookPostStatus === "new" ? "Post webhook" : "Repost webhook"}
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onClick={() => setConfirmDeleteOpen(true)}>
                            <DeleteIcon className="size-4" /> Delete meeting
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete this meeting?</DialogTitle>
                        <DialogDescription>
                            This removes it from your meetings list. This does not undo an export that already
                            happened (a downloaded file, a posted webhook, or a note already sent to Obsidian).
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmDeleteOpen(false)}>
                            Cancel
                        </Button>
                        <Button variant="destructive" onClick={handleConfirmDelete}>
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {contextDialog && (
                <ContextExceededDialog
                    open
                    requiredTokens={contextDialog.requiredTokens}
                    loadedContextLength={contextDialog.loadedContextLength}
                    onOpenChange={(open) => !open && setContextDialog(null)}
                    onRetry={() => {
                        setContextDialog(null)
                        regenerateSummary()
                    }}
                />
            )}
        </div>
    )
}
