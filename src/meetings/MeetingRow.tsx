import { useState } from "react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { asErrorObject, sendMessage } from "@/lib/messaging"
import downloadIcon from "../../extension/icons/download.svg"
import webhookIcon from "../../extension/icons/webhook.svg"
import deleteIcon from "../../extension/icons/delete.svg"

function formatDuration(startIso: string, endIso: string) {
    const duration = new Date(endIso).getTime() - new Date(startIso).getTime()
    const durationMinutes = Math.round(duration / (1000 * 60))
    const durationHours = Math.floor(durationMinutes / 60)
    const remainingMinutes = durationMinutes % 60
    return durationHours > 0 ? `${durationHours}h ${remainingMinutes}m` : `${durationMinutes}m`
}

function WebhookStatusBadge({ status }: { status: Meeting["webhookPostStatus"] }) {
    switch (status) {
        case "successful":
            return <Badge className="bg-green-500/15 text-green-600 dark:text-green-400">Successful</Badge>
        case "failed":
            return <Badge className="bg-destructive/15 text-destructive">Failed</Badge>
        case "new":
            return <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400">New</Badge>
        default:
            return <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400">Unknown</Badge>
    }
}

function ObsidianStatusBadge({ status }: { status: Meeting["obsidianSaveStatus"] }) {
    switch (status) {
        case "handed_off":
            return <Badge className="bg-green-500/15 text-green-600 dark:text-green-400">Sent</Badge>
        case "failed":
            return <Badge className="bg-destructive/15 text-destructive">Failed</Badge>
        case "pending":
            return <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400">Pending</Badge>
        default:
            return <span className="text-muted-foreground text-xs">Not sent</span>
    }
}

interface MeetingRowProps {
    meeting: Meeting
    index: number
    onRenamed: (index: number, newTitle: string) => void
    onDeleted: (index: number) => void
    onChanged: () => void
}

export default function MeetingRow({ meeting, index, onRenamed, onDeleted, onChanged }: MeetingRowProps) {
    const [isPostingWebhook, setIsPostingWebhook] = useState(false)
    const [isSavingObsidian, setIsSavingObsidian] = useState(false)
    const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

    const timestamp = new Date(meeting.meetingStartTimestamp).toLocaleString()
    const durationString = formatDuration(meeting.meetingStartTimestamp, meeting.meetingEndTimestamp)

    function handleTitleBlur(e: React.FocusEvent<HTMLDivElement>) {
        const newTitle = e.currentTarget.innerText
        onRenamed(index, newTitle)
    }

    function handleDownload() {
        sendMessage({ type: "download_transcript_at_index", index }).then((response) => {
            if (!response.success) {
                alert("Could not download transcript")
                const parsedError = asErrorObject(response.message)
                if (parsedError) {
                    console.error(parsedError.errorMessage)
                }
            }
        })
    }

    function handleWebhookPost() {
        setIsPostingWebhook(true)
        sendMessage({ type: "post_webhook_at_index", index }).then((response) => {
            setIsPostingWebhook(false)
            onChanged()
            if (response.success) {
                alert("Posted successfully!")
            } else {
                const parsedError = asErrorObject(response.message)
                if (parsedError) {
                    console.error(parsedError.errorMessage)
                }
            }
        })
    }

    function handleSaveToObsidian() {
        // Stable id — must match extension/obsidian/store.js's getMeetingId().
        const meetingId = meeting.meetingStartTimestamp
        setIsSavingObsidian(true)
        sendMessage({ type: "save_meeting_to_obsidian", meetingId }).then((response) => {
            setIsSavingObsidian(false)
            onChanged()
            if (!response.success) {
                const parsedError = asErrorObject(response.message)
                if (parsedError?.errorCode === "018") {
                    alert("Please configure and save an Obsidian vault name first.")
                } else {
                    alert("Could not save to Obsidian")
                    if (parsedError) {
                        console.error(parsedError.errorMessage)
                    }
                }
            }
        })
    }

    function handleConfirmDelete() {
        setConfirmDeleteOpen(false)
        onDeleted(index)
    }

    return (
        <tr className="border-b">
            <td className="px-4 py-3">
                <div
                    contentEditable
                    suppressContentEditableWarning
                    title="Rename"
                    className="focus-visible:ring-ring/50 rounded p-1 underline decoration-muted-foreground underline-offset-4 outline-none hover:outline hover:outline-muted-foreground focus-visible:ring-3"
                    onBlur={handleTitleBlur}
                >
                    {meeting.meetingTitle || meeting.title || "Google Meet call"}
                </div>
            </td>
            <td className="px-4 py-3">{meeting.meetingSoftware || ""}</td>
            <td className="px-4 py-3 whitespace-nowrap">
                {timestamp} &nbsp;&#9679;&nbsp; {durationString}
            </td>
            <td className="px-4 py-3">
                <WebhookStatusBadge status={meeting.webhookPostStatus} />
            </td>
            <td className="px-4 py-3">
                <ObsidianStatusBadge status={meeting.obsidianSaveStatus} />
            </td>
            <td className="px-4 py-3">
                {meeting.llmSummaryMarkdown ? (
                    <Collapsible>
                        <CollapsibleTrigger className="text-primary text-xs font-bold whitespace-nowrap">
                            View summary
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                            <pre className="bg-foreground/5 mt-1 max-h-64 max-w-xs overflow-y-auto rounded p-2 text-xs whitespace-pre-wrap">
                                {meeting.llmSummaryMarkdown}
                            </pre>
                        </CollapsibleContent>
                    </Collapsible>
                ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                )}
            </td>
            <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-4">
                    <button
                        type="button"
                        className="text-primary flex flex-col justify-end text-xs"
                        title="Download"
                        aria-label="Download this meeting transcript"
                        onClick={handleDownload}
                    >
                        <img src={downloadIcon} alt="" />
                    </button>
                    <button
                        type="button"
                        className="text-primary flex flex-col justify-end text-xs disabled:opacity-50"
                        title={meeting.webhookPostStatus === "new" ? "Post webhook" : "Repost webhook"}
                        aria-label={meeting.webhookPostStatus === "new" ? "Post webhook" : "Repost webhook"}
                        disabled={isPostingWebhook}
                        onClick={handleWebhookPost}
                    >
                        <img src={webhookIcon} alt="" />
                    </button>
                    <button
                        type="button"
                        className="border-primary text-primary rounded border px-2 py-1 text-xs font-bold whitespace-nowrap disabled:opacity-50"
                        title="Save to Obsidian"
                        aria-label="Save this meeting to Obsidian"
                        disabled={isSavingObsidian}
                        onClick={handleSaveToObsidian}
                    >
                        {isSavingObsidian ? "Sending…" : "Save to Obsidian"}
                    </button>
                    <button
                        type="button"
                        className="text-primary flex flex-col justify-end text-xs"
                        title="Delete"
                        aria-label="Delete this meeting"
                        onClick={() => setConfirmDeleteOpen(true)}
                    >
                        <img src={deleteIcon} alt="" />
                    </button>
                </div>
            </td>

            <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete this meeting?</DialogTitle>
                        <DialogDescription>
                            This removes it from the last-10-meetings list. This does not undo an export that
                            already happened (a downloaded file, a posted webhook, or a note already sent to
                            Obsidian).
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
        </tr>
    )
}
