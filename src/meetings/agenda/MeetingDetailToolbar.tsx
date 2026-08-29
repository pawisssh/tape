import { useState } from "react"
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
import CircleIconButton from "../ui/CircleIconButton"
import { ContentCopyIcon, DownloadIcon, MoreHorizIcon, WebhookIcon, DeleteIcon } from "../ui/icons"
import FollowUpTemplatePicker from "./FollowUpTemplatePicker"

interface MeetingDetailToolbarProps {
    meeting: Meeting
    index: number
    onDeleted: (index: number) => void
    onChanged: () => void
    onTemplateOverrideChange: (templateOverrideId: string | undefined) => Promise<void>
    // Lifted to MeetingsView.tsx (shared with MeetingDetail.tsx's Run flow) and keyed by
    // meeting id — see MeetingDetail.tsx's own doc comment on this same prop pair.
    operation: { meetingId: string; label: string } | null
    onOperationChange: (operation: { meetingId: string; label: string } | null) => void
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
}: MeetingDetailToolbarProps) {
    const [isPostingWebhook, setIsPostingWebhook] = useState(false)
    const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

    // Stable id — must match extension/obsidian/store.js's getMeetingId().
    const meetingId = meeting.meetingStartTimestamp
    const busy = operation?.meetingId === meetingId

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
    // that drives the sticky status bar and talks to the background's
    // summarize_meeting_now handler.
    async function regenerateSummary() {
        onOperationChange({ meetingId, label: "Summarizing…" })
        const response = await sendMessage({ type: "summarize_meeting_now", meetingId })
        onOperationChange(null)
        onChanged()
        if (response.success) {
            toast.add({ title: "Summary ready", type: "success" })
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
                <div className="flex items-center gap-0 rounded-full bg-white p-1 shadow-[0px_16px_16px_rgba(12,12,13,0.1),0px_4px_2px_rgba(12,12,13,0.05)]">
                    <CircleIconButton bare label="Copy transcript" icon={<ContentCopyIcon />} onClick={handleCopyTranscript} />
                    <CircleIconButton bare label="Download transcript" icon={<DownloadIcon />} onClick={handleDownload} />
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger render={<CircleIconButton label="More actions" icon={<MoreHorizIcon />} />} />
                    <DropdownMenuContent align="start">
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
        </div>
    )
}
