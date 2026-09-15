import { forwardRef, useEffect, useImperativeHandle, useState } from "react"
import { ArticleIcon } from "./ui/icons"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { getSync, onStorageChanged, setSync } from "@/lib/chrome-storage"
import { isInsecureUrl, requestPermissions, webhookOriginPattern } from "@/lib/permissions"
import { toast } from "@/components/ui/toast"
import { useDebouncedEffect } from "@/hooks/use-debounced-effect"
import InsecureUrlWarning from "./ui/InsecureUrlWarning"

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

export interface WebhookSectionHandle {
    connect: () => void
}

interface WebhookSectionProps {
    // The Connect action's button now lives in IntegrationsView.tsx's header (matching
    // the redesigned Templates/Meetings header pattern) rather than in this panel's own
    // body, so its trigger (connect()) and live state are exposed upward instead of
    // rendering a button here — see ProviderPanel.tsx for the same pattern.
    onConnectingChange?: (isConnecting: boolean) => void
    onCanConnectChange?: (canConnect: boolean) => void
}

// Rendered directly in the Integrations page's detail panel (see IntegrationsView.tsx) —
// no Dialog/modal chrome of its own.
const WebhookSection = forwardRef<WebhookSectionHandle, WebhookSectionProps>(function WebhookSection(
    { onConnectingChange, onCanConnectChange },
    ref,
) {
    const [webhookUrl, setWebhookUrl] = useState("")
    const [autoPost, setAutoPost] = useState(true)
    const [autoDownload, setAutoDownload] = useState(true)
    const [obsidianAutoSaveOn, setObsidianAutoSaveOn] = useState(false)
    const [bodyType, setBodyType] = useState<"simple" | "advanced">("simple")
    const [isConnecting, setIsConnecting] = useState(false)
    const [insecureAcknowledged, setInsecureAcknowledged] = useState(false)

    useEffect(() => {
        function load() {
            getSync<ResultSync>([
                "webhookUrl",
                "autoPostWebhookAfterMeeting",
                "autoDownloadFileAfterMeeting",
                "webhookBodyType",
                "obsidianVaultName",
            ]).then((result) => {
                setWebhookUrl(result.webhookUrl || "")
                setAutoPost(result.autoPostWebhookAfterMeeting === true)
                setAutoDownload(result.autoDownloadFileAfterMeeting !== false)
                setBodyType(result.webhookBodyType === "advanced" ? "advanced" : "simple")
                // Obsidian auto-save has no toggle of its own — it's on whenever a vault
                // name is configured (see getObsidianSettings() in store.js).
                setObsidianAutoSaveOn(!!result.obsidianVaultName)
            })
        }
        load()
        return onStorageChanged((changes, area) => {
            if (area === "sync" && changes.obsidianVaultName) {
                setObsidianAutoSaveOn(!!changes.obsidianVaultName.newValue)
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

    // Autosave only covers clearing the field — writing a non-empty URL needs a host
    // permission grant, and Chrome refuses chrome.permissions.request() calls made
    // outside a genuine click, so that path stays behind the explicit Connect button
    // (handleConnect) below rather than firing from this debounce timer.
    useDebouncedEffect(
        () => {
            if (webhookUrl === "") {
                setSync({ webhookUrl })
            }
        },
        [webhookUrl],
        700,
    )

    // Editing the URL after acknowledging an insecure one re-arms the warning — acknowledging
    // "this http:// URL is fine" shouldn't silently carry over to a different URL typed next.
    useEffect(() => {
        setInsecureAcknowledged(false)
    }, [webhookUrl])

    const showInsecureWarning = isInsecureUrl(webhookUrl) && !insecureAcknowledged

    function performConnect() {
        setIsConnecting(true)
        requestWebhookAndNotificationPermission(webhookUrl)
            .then((granted) => {
                if (!granted) throw new Error("Permission denied")
                return setSync({ webhookUrl })
            })
            .then(() => {
                setIsConnecting(false)
                toast.add({ title: "Webhook URL saved", type: "success" })
            })
            .catch((error) => {
                setIsConnecting(false)
                toast.add({
                    title: "Webhook URL not saved",
                    description: "Permission to contact that URL was denied.",
                    type: "error",
                })
                console.error("Webhook permission error:", error)
            })
    }

    function handleConnect() {
        if (showInsecureWarning) {
            // Don't proceed silently — the inline warning below the field (with its own
            // "Connect anyway" button) is the actual path forward; nudge the user there
            // since Connect itself is triggered from IntegrationsView.tsx's header, which
            // may be scrolled away from the warning.
            toast.add({ title: "Acknowledge the security warning below to connect", type: "warning" })
            return
        }
        performConnect()
    }

    useImperativeHandle(ref, () => ({ connect: handleConnect }))

    useEffect(() => {
        onConnectingChange?.(isConnecting)
    }, [isConnecting, onConnectingChange])

    useEffect(() => {
        onCanConnectChange?.(!!webhookUrl.trim())
    }, [webhookUrl, onCanConnectChange])

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
        <div className="flex flex-col gap-6">
            <div>
                <Label htmlFor="webhook-url">Webhook URL</Label>
                <Input
                    type="url"
                    id="webhook-url"
                    className="mt-2 rounded-none"
                    placeholder="https://your-webhook-url.com"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                />
                {showInsecureWarning && (
                    <div className="mt-2">
                        <InsecureUrlWarning
                            onAcknowledge={() => {
                                setInsecureAcknowledged(true)
                                performConnect()
                            }}
                        />
                    </div>
                )}
            </div>

            <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                    <Checkbox id="auto-post-webhook" checked={autoPost} onCheckedChange={(v) => handleAutoPostChange(v === true)} />
                    <Label htmlFor="auto-post-webhook">Automatically post transcript to webhook URL, after each meeting</Label>
                </div>
                {anotherExporterActive ? (
                    <div className="flex items-center gap-2">
                        <Checkbox
                            id="auto-download-file"
                            checked={autoDownload}
                            onCheckedChange={(v) => handleAutoDownloadChange(v === true)}
                        />
                        <Label htmlFor="auto-download-file">Automatically download transcript text file, after each meeting</Label>
                    </div>
                ) : null}
            </div>

            <RadioGroup value={bodyType} onValueChange={handleBodyTypeChange} className="gap-4">
                <div className="flex items-start gap-2">
                    <RadioGroupItem value="simple" id="simple-webhook-body" className="mt-0.5" />
                    <Label htmlFor="simple-webhook-body" className="flex-col items-start font-normal">
                        <span className="font-bold text-meetings-ink">Simple webhook body</span>
                        <span className="text-meetings-ink-muted">Pre-formatted data, suitable for no-code integrations</span>
                    </Label>
                </div>
                <div className="flex items-start gap-2">
                    <RadioGroupItem value="advanced" id="advanced-webhook-body" className="mt-0.5" />
                    <Label htmlFor="advanced-webhook-body" className="flex-col items-start font-normal">
                        <span className="font-bold text-meetings-ink">Advanced webhook body</span>
                        <span className="text-meetings-ink-muted">Raw data, suitable for code integrations</span>
                    </Label>
                </div>
            </RadioGroup>

            <div>
                <p className="text-base font-bold text-meetings-ink">Webhook help</p>
                <p className="mt-1 mb-3 text-sm text-meetings-ink-muted">Integration guides</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <a
                        className="flex items-start gap-2 border border-meetings-border p-2 font-bold text-meetings-ink"
                        href="https://github.com/vivek-nexus/transcriptonic/wiki/Google-Docs-integration-guide?utm_source=extension"
                        target="_blank"
                        rel="noreferrer"
                    >
                        <ArticleIcon className="size-4" />
                        <span>Get transcripts on Google Docs</span>
                    </a>
                    <a
                        className="flex items-start gap-2 border border-meetings-border p-2 font-bold text-meetings-ink"
                        href="https://github.com/vivek-nexus/transcriptonic/wiki/n8n-integration-guide?utm_source=extension"
                        target="_blank"
                        rel="noreferrer"
                    >
                        <ArticleIcon className="size-4" />
                        <span>Using webhooks with n8n</span>
                    </a>
                </div>
            </div>

            <div>
                <p className="text-base font-bold text-meetings-ink">Webhook JSON body</p>
                <div className="mt-2 flex flex-col gap-2">
                    <Collapsible>
                        <CollapsibleTrigger className="font-bold text-meetings-ink">Webhook body (simple)</CollapsibleTrigger>
                        <CollapsibleContent>
                            <pre className="my-4 overflow-x-auto border border-meetings-border bg-meetings-chip p-4 text-xs leading-relaxed">
                                {SIMPLE_BODY_EXAMPLE}
                            </pre>
                        </CollapsibleContent>
                    </Collapsible>
                    <Collapsible>
                        <CollapsibleTrigger className="font-bold text-meetings-ink">Webhook body (advanced)</CollapsibleTrigger>
                        <CollapsibleContent>
                            <pre className="my-4 overflow-x-auto border border-meetings-border bg-meetings-chip p-4 text-xs leading-relaxed">
                                {ADVANCED_BODY_EXAMPLE}
                            </pre>
                        </CollapsibleContent>
                    </Collapsible>
                </div>
            </div>
        </div>
    )
})

export default WebhookSection
