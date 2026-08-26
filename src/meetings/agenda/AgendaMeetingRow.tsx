import { useState } from "react"
import { ChevronDown, Download, Webhook, Trash2, MoreHorizontal } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { asErrorObject, sendMessage } from "@/lib/messaging"
import SummaryPanel from "../summary/SummaryPanel"
import { cn } from "@/lib/utils"

function formatDuration(startIso: string, endIso: string) {
    const duration = new Date(endIso).getTime() - new Date(startIso).getTime()
    const durationMinutes = Math.round(duration / (1000 * 60))
    const durationHours = Math.floor(durationMinutes / 60)
    const remainingMinutes = durationMinutes % 60
    return durationHours > 0 ? `${durationHours}h ${remainingMinutes}m` : `${durationMinutes}m`
}

function platformDotClass(software: Meeting["meetingSoftware"]) {
    switch (software) {
        case "Google Meet":
            return "bg-emerald-500"
        case "Teams":
            return "bg-indigo-500"
        case "Zoom":
            return "bg-sky-500"
        default:
            return "bg-muted-foreground"
    }
}

function WebhookStatusBadge({ status }: { status: Meeting["webhookPostStatus"] }) {
    switch (status) {
        case "successful":
            return <Badge className="bg-green-500/15 text-green-600 dark:text-green-400">Webhook sent</Badge>
        case "failed":
            return <Badge className="bg-destructive/15 text-destructive">Webhook failed</Badge>
        default:
            return null
    }
}

function ObsidianStatusBadge({ status }: { status: Meeting["obsidianSaveStatus"] }) {
    switch (status) {
        case "handed_off":
            return <Badge className="bg-green-500/15 text-green-600 dark:text-green-400">Saved to Obsidian</Badge>
        case "failed":
            return <Badge className="bg-destructive/15 text-destructive">Obsidian failed</Badge>
        case "pending":
            return <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400">Obsidian pending</Badge>
        default:
            return null
    }
}

interface AgendaMeetingRowProps {
    meeting: Meeting
    index: number
    onRenamed: (index: number, newTitle: string) => void
    onDeleted: (index: number) => void
    onChanged: () => void
}

export default function AgendaMeetingRow({ meeting, index, onRenamed, onDeleted, onChanged }: AgendaMeetingRowProps) {
    const [isPostingWebhook, setIsPostingWebhook] = useState(false)
    const [isSavingObsidian, setIsSavingObsidian] = useState(false)
    const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

    const startDate = new Date(meeting.meetingStartTimestamp)
    const timeLabel = startDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
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
        <Collapsible className="group/row">
            <div className="flex items-center gap-3 border-b px-3 py-3 last:border-b-0">
                <span className="text-muted-foreground w-14 shrink-0 text-xs tabular-nums">{timeLabel}</span>
                <span
                    aria-hidden
                    className={cn("size-2 shrink-0 rounded-full", platformDotClass(meeting.meetingSoftware))}
                />
                <div className="min-w-0 flex-1">
                    <div
                        contentEditable
                        suppressContentEditableWarning
                        title="Rename"
                        className="focus-visible:ring-ring/50 w-fit max-w-full truncate rounded p-0.5 text-sm font-medium outline-none hover:outline hover:outline-muted-foreground focus-visible:ring-3"
                        onBlur={handleTitleBlur}
                    >
                        {meeting.meetingTitle || meeting.title || "Google Meet call"}
                    </div>
                    <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                        <span>{durationString}</span>
                        {meeting.meetingSoftware ? <span>· {meeting.meetingSoftware}</span> : null}
                    </div>
                </div>
                <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
                    <WebhookStatusBadge status={meeting.webhookPostStatus} />
                    <ObsidianStatusBadge status={meeting.obsidianSaveStatus} />
                </div>
                <CollapsibleTrigger className="text-muted-foreground shrink-0 rounded p-1 hover:bg-muted [&[data-open]>svg]:rotate-180">
                    <ChevronDown className="size-4 transition-transform" />
                </CollapsibleTrigger>
            </div>

            <CollapsibleContent>
                <div className="bg-foreground/[0.02] border-b px-3 py-4 pl-[4.75rem] last:border-b-0">
                    <SummaryPanel markdown={meeting.llmSummaryMarkdown} />

                    <div className="mt-4 flex items-center gap-2">
                        <Button size="sm" disabled={isSavingObsidian} onClick={handleSaveToObsidian}>
                            {isSavingObsidian ? "Sending…" : "Save to Obsidian"}
                        </Button>

                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <Button
                                        size="icon-sm"
                                        variant="outline"
                                        disabled={isPostingWebhook}
                                        onClick={handleWebhookPost}
                                        aria-label={meeting.webhookPostStatus === "new" ? "Post webhook" : "Repost webhook"}
                                    >
                                        <Webhook />
                                    </Button>
                                }
                            />
                            <TooltipContent>
                                {meeting.webhookPostStatus === "new" ? "Post webhook" : "Repost webhook"}
                            </TooltipContent>
                        </Tooltip>

                        <DropdownMenu>
                            <DropdownMenuTrigger
                                render={
                                    <Button size="icon-sm" variant="outline" aria-label="More actions">
                                        <MoreHorizontal />
                                    </Button>
                                }
                            />
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={handleDownload}>
                                    <Download /> Download transcript
                                </DropdownMenuItem>
                                <DropdownMenuItem variant="destructive" onClick={() => setConfirmDeleteOpen(true)}>
                                    <Trash2 /> Delete meeting
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
            </CollapsibleContent>

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
        </Collapsible>
    )
}
