import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { getSync, onStorageChanged, setSync } from "@/lib/chrome-storage"
import { requestPermissions, webhookOriginPattern } from "@/lib/permissions"
import webhookWhiteIcon from "../../extension/icons/webhook-white.svg"
import guideIcon from "../../extension/icons/guide.svg"

const SIMPLE_BODY_EXAMPLE = `{
    "webhookBodyType": "simple",
    "meetingSoftware": "Google Meet",
    "meetingTitle": "Team meeting",
    "meetingStartTimestamp": "01/15/2024, 10:00 AM",
    "meetingEndTimestamp": "01/15/2024, 11:00 AM",
    "transcript": "Priya (01/15/2024, 10:00 AM)\\nHi everyone!\\n\\nCarlos (01/15/2024, 10:01 AM)\\nHello Priya!...\\n\\n",
    "chatMessages": "Mohammed (01/15/2024, 10:05 AM)\\nCan you share the slides?\\n\\nSofia (01/15/2024, 10:06 AM)\\nHere's the link: ...\\n\\n"
}`

const ADVANCED_BODY_EXAMPLE = `{
    "webhookBodyType": "advanced",
    "meetingSoftware": "Google Meet",
    "meetingTitle": "Team meeting",
    "meetingStartTimestamp": "2024-01-15T10:00:00.000Z",
    "meetingEndTimestamp": "2024-01-15T11:00:00.000Z",
    "transcript": [
        {
            "personName": "Priya",
            "timestamp": "2024-01-15T10:00:00.000Z",
            "transcriptText": "Hi everyone!"
        },
        {
            "personName": "Carlos",
            "timestamp": "2024-01-15T10:01:00.000Z",
            "transcriptText": "Hello Priya!"
        }
    ],
    "chatMessages": [
        {
            "personName": "Mohammed",
            "timestamp": "2024-01-15T10:05:00.000Z",
            "chatMessageText": "Can you share the slides?"
        },
        {
            "personName": "Sofia",
            "timestamp": "2024-01-15T10:06:00.000Z",
            "chatMessageText": "Here's the link: ..."
        }
    ]
}`

export default function WebhookSection() {
    const [webhookUrl, setWebhookUrl] = useState("")
    const [autoPost, setAutoPost] = useState(true)
    const [autoDownload, setAutoDownload] = useState(true)
    const [obsidianAutoSaveOn, setObsidianAutoSaveOn] = useState(false)
    const [bodyType, setBodyType] = useState<"simple" | "advanced">("simple")

    useEffect(() => {
        function load() {
            getSync<ResultSync>([
                "webhookUrl",
                "autoPostWebhookAfterMeeting",
                "autoDownloadFileAfterMeeting",
                "webhookBodyType",
                "autoSaveToObsidianAfterMeeting",
            ]).then((result) => {
                setWebhookUrl(result.webhookUrl || "")
                setAutoPost(result.autoPostWebhookAfterMeeting === true)
                setAutoDownload(result.autoDownloadFileAfterMeeting !== false)
                setBodyType(result.webhookBodyType === "advanced" ? "advanced" : "simple")
                setObsidianAutoSaveOn(result.autoSaveToObsidianAfterMeeting === true)
            })
        }
        load()
        return onStorageChanged((changes, area) => {
            if (area === "sync" && changes.autoSaveToObsidianAfterMeeting) {
                setObsidianAutoSaveOn(changes.autoSaveToObsidianAfterMeeting.newValue === true)
            }
        })
    }, [])

    // The .txt download must stay an always-on fallback unless another exporter (webhook
    // or Obsidian) is active, so the user is never left with zero export paths.
    const anotherExporterActive = autoPost || obsidianAutoSaveOn

    useEffect(() => {
        if (!anotherExporterActive && !autoDownload) {
            setAutoDownload(true)
            setSync({ autoDownloadFileAfterMeeting: true })
        }
    }, [anotherExporterActive, autoDownload])

    function requestWebhookAndNotificationPermission(url: string): Promise<boolean> {
        const originPattern = webhookOriginPattern(url)
        if (!originPattern) return Promise.resolve(false)
        return requestPermissions([originPattern], ["notifications"])
    }

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (webhookUrl === "") {
            setSync({ webhookUrl }).then(() => alert("Webhook URL saved!"))
            return
        }
        requestWebhookAndNotificationPermission(webhookUrl)
            .then((granted) => {
                if (!granted) throw new Error("Permission denied")
                return setSync({ webhookUrl })
            })
            .then(() => alert("Webhook URL saved!"))
            .catch((error) => {
                alert("Fine! No webhooks for you!")
                console.error("Webhook permission error:", error)
            })
    }

    function handleAutoPostChange(checked: boolean) {
        setAutoPost(checked)
        setSync({ autoPostWebhookAfterMeeting: checked })
    }

    function handleAutoDownloadChange(checked: boolean) {
        if (!checked && !confirm("Text file serves as a harmless backup, you sure you don't need it?")) {
            return
        }
        setAutoDownload(checked)
        setSync({ autoDownloadFileAfterMeeting: checked })
    }

    function handleBodyTypeChange(value: string) {
        const next = value === "advanced" ? "advanced" : "simple"
        setBodyType(next)
        setSync({ webhookBodyType: next })
    }

    return (
        <section id="webhooks" className="mb-20">
            <h2 className="text-xl font-bold">Integrate TranscripTonic with your favourite tools</h2>
            <p className="text-muted-foreground mt-2 mb-4">
                You can connect TranscripTonic directly to any tool that supports webhooks. If it does not, you can
                use automation tools like n8n as a bridge.
            </p>

            <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
                <div className="bg-foreground/5 rounded-lg py-6">
                    <div className="bg-primary/10 -mt-6 mb-6 flex items-center gap-2 px-6 py-4">
                        <p className="font-bold">Configure webhook</p>
                        <img src={webhookWhiteIcon} alt="" width={20} />
                    </div>
                    <form onSubmit={handleSubmit} className="px-6">
                        <Label htmlFor="webhook-url">Webhook URL</Label>
                        <div className="mt-2 flex">
                            <Input
                                type="url"
                                id="webhook-url"
                                className="rounded-r-none"
                                placeholder="https://your-webhook-url.com"
                                value={webhookUrl}
                                onChange={(e) => setWebhookUrl(e.target.value)}
                            />
                            <Button type="submit" className="rounded-l-none">
                                Save
                            </Button>
                        </div>
                    </form>

                    <hr className="my-6" />

                    <div className="px-6">
                        <div className="flex items-center gap-2">
                            <Checkbox id="auto-post-webhook" checked={autoPost} onCheckedChange={(v) => handleAutoPostChange(v === true)} />
                            <Label htmlFor="auto-post-webhook">Automatically post transcript to webhook URL, after each meeting</Label>
                        </div>
                        {anotherExporterActive ? (
                            <div className="mt-6 flex items-center gap-2">
                                <Checkbox
                                    id="auto-download-file"
                                    checked={autoDownload}
                                    onCheckedChange={(v) => handleAutoDownloadChange(v === true)}
                                />
                                <Label htmlFor="auto-download-file">Automatically download transcript text file, after each meeting</Label>
                            </div>
                        ) : null}
                    </div>

                    <hr className="my-6" />

                    <RadioGroup value={bodyType} onValueChange={handleBodyTypeChange} className="gap-4 px-6">
                        <div className="flex items-start gap-2">
                            <RadioGroupItem value="simple" id="simple-webhook-body" className="mt-0.5" />
                            <Label htmlFor="simple-webhook-body" className="flex-col items-start font-normal">
                                <span className="font-bold">Simple webhook body</span>
                                <span className="text-muted-foreground">Pre-formatted data, suitable for no-code integrations</span>
                            </Label>
                        </div>
                        <div className="flex items-start gap-2">
                            <RadioGroupItem value="advanced" id="advanced-webhook-body" className="mt-0.5" />
                            <Label htmlFor="advanced-webhook-body" className="flex-col items-start font-normal">
                                <span className="font-bold">Advanced webhook body</span>
                                <span className="text-muted-foreground">Raw data, suitable for code integrations</span>
                            </Label>
                        </div>
                    </RadioGroup>
                </div>

                <div className="bg-foreground/5 rounded-lg py-6">
                    <div className="bg-primary/10 -mt-6 mb-6 flex items-center gap-2 px-6 py-4">
                        <p className="font-bold">Webhook help</p>
                    </div>
                    <p className="px-6 font-bold">Webhook integration guides</p>
                    <div className="grid grid-cols-1 gap-3 px-6 py-3 sm:grid-cols-2">
                        <a
                            className="border-primary/50 text-primary flex items-start gap-2 rounded-lg border p-2 font-bold"
                            href="https://github.com/vivek-nexus/transcriptonic/wiki/Google-Docs-integration-guide?utm_source=extension"
                            target="_blank"
                            rel="noreferrer"
                        >
                            <img src={guideIcon} alt="" width={16} />
                            <span>Get transcripts on Google Docs</span>
                        </a>
                        <a
                            className="border-primary/50 text-primary flex items-start gap-2 rounded-lg border p-2 font-bold"
                            href="https://github.com/vivek-nexus/transcriptonic/wiki/n8n-integration-guide?utm_source=extension"
                            target="_blank"
                            rel="noreferrer"
                        >
                            <img src={guideIcon} alt="" width={16} />
                            <span>Using webhooks with n8n</span>
                        </a>
                    </div>
                    <hr className="my-6" />
                    <p className="px-6 font-bold">Webhook JSON body</p>
                    <div className="px-6">
                        <Collapsible>
                            <CollapsibleTrigger className="text-primary font-bold">Webhook body (simple)</CollapsibleTrigger>
                            <CollapsibleContent>
                                <pre className="bg-foreground/5 my-4 overflow-x-auto rounded-lg p-4 text-xs leading-relaxed">
                                    {SIMPLE_BODY_EXAMPLE}
                                </pre>
                            </CollapsibleContent>
                        </Collapsible>
                        <Collapsible>
                            <CollapsibleTrigger className="text-primary font-bold">Webhook body (advanced)</CollapsibleTrigger>
                            <CollapsibleContent>
                                <pre className="bg-foreground/5 my-4 overflow-x-auto rounded-lg p-4 text-xs leading-relaxed">
                                    {ADVANCED_BODY_EXAMPLE}
                                </pre>
                            </CollapsibleContent>
                        </Collapsible>
                    </div>
                </div>
            </div>
        </section>
    )
}
