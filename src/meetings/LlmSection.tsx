import { useEffect, useState } from "react"
import { Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardAction } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getSync, setSync } from "@/lib/chrome-storage"
import { endpointOriginPattern, hasPermissions, requestPermissions } from "@/lib/permissions"

// Kept in sync with extension/obsidian/llm.js's DEFAULT_LLM_ENDPOINT/DEFAULT_LLM_MODEL/
// DEFAULT_LLM_TIMEOUT_MS, for the same "single string constant, don't pull in the whole
// module" reason documented in ObsidianSection.tsx.
const DEFAULT_LLM_ENDPOINT = "http://localhost:1234/v1/chat/completions"
const DEFAULT_LLM_MODEL = ""
const DEFAULT_LLM_TIMEOUT_MS = 90000

export default function LlmSection() {
    const [endpoint, setEndpoint] = useState(DEFAULT_LLM_ENDPOINT)
    const [model, setModel] = useState(DEFAULT_LLM_MODEL)
    const [timeoutMs, setTimeoutMs] = useState(String(DEFAULT_LLM_TIMEOUT_MS))
    const [enabled, setEnabled] = useState(false)
    const [checkboxDisabled, setCheckboxDisabled] = useState(false)

    useEffect(() => {
        getSync<ResultSync>(["obsidianLlmEndpoint", "obsidianLlmModel", "obsidianLlmTimeoutMs", "obsidianUseLlm"]).then(
            (result) => {
                const loadedEndpoint = result.obsidianLlmEndpoint || DEFAULT_LLM_ENDPOINT
                setEndpoint(loadedEndpoint)
                setModel(result.obsidianLlmModel || DEFAULT_LLM_MODEL)
                setTimeoutMs(String(result.obsidianLlmTimeoutMs || DEFAULT_LLM_TIMEOUT_MS))

                // Only ever reflect a *granted* permission as "on" — obsidianUseLlm must
                // never silently read as enabled without the matching host permission, so
                // the extension stays fully functional (falls through to the
                // null-fallback path) even if the permission was revoked out-of-band
                // (e.g. via chrome://extensions) after being saved as true.
                const wantsLlm = result.obsidianUseLlm === true
                if (!wantsLlm) {
                    setEnabled(false)
                    return
                }
                const originPattern = endpointOriginPattern(loadedEndpoint)
                if (!originPattern) {
                    setEnabled(false)
                    return
                }
                hasPermissions([originPattern]).then((granted) => {
                    setEnabled(granted)
                    if (!granted) {
                        // Permission was revoked since this was last saved as "on" —
                        // reflect reality in storage too, so
                        // triggerObsidianHandoffIfConfigured's read of obsidianUseLlm
                        // doesn't disagree with what the UI shows.
                        setSync({ obsidianUseLlm: false })
                    }
                })
            },
        )
    }, [])

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        const parsedTimeout = parseInt(timeoutMs, 10)
        setSync({
            obsidianLlmEndpoint: endpoint.trim() || DEFAULT_LLM_ENDPOINT,
            obsidianLlmModel: model.trim(),
            obsidianLlmTimeoutMs: Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : DEFAULT_LLM_TIMEOUT_MS,
        }).then(() => alert("LLM settings saved!"))
    }

    // The permission request MUST happen directly inside this checkbox's own
    // change-handler call stack so it counts as a genuine user gesture — Chrome refuses
    // chrome.permissions.request() calls made outside one (e.g. from a blur handler or
    // an unrelated effect).
    function handleEnabledChange(checked: boolean) {
        if (!checked) {
            setEnabled(false)
            setSync({ obsidianUseLlm: false })
            return
        }

        const trimmedEndpoint = endpoint.trim() || DEFAULT_LLM_ENDPOINT
        const originPattern = endpointOriginPattern(trimmedEndpoint)
        if (!originPattern) {
            alert("Please enter a valid endpoint URL before enabling LLM summaries.")
            return
        }

        setCheckboxDisabled(true)
        requestPermissions([originPattern])
            .then((granted) => {
                setCheckboxDisabled(false)
                if (granted) {
                    setEnabled(true)
                    setSync({ obsidianUseLlm: true, obsidianLlmEndpoint: trimmedEndpoint })
                } else {
                    setEnabled(false)
                    setSync({ obsidianUseLlm: false })
                }
            })
            .catch((error) => {
                setCheckboxDisabled(false)
                setEnabled(false)
                setSync({ obsidianUseLlm: false })
                console.error("LLM endpoint permission error:", error)
                alert("Could not request permission for that endpoint. Enable LLM summaries again once fixed.")
            })
    }

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center gap-2">
                    <Sparkles className="text-muted-foreground size-5" />
                    <CardTitle>Local LLM summary</CardTitle>
                </div>
                <CardDescription>
                    Optionally enrich the note handed off to Obsidian with a summary generated by a locally-running
                    LLM server (LM Studio, Ollama, or anything else that speaks the OpenAI chat-completions API).
                    This never blocks or breaks the plain transcript export — if the server is unreachable, times
                    out, or returns something unusable, the note is saved without a summary, exactly as if this
                    feature were off.
                </CardDescription>
                <CardAction>
                    <Badge variant={enabled ? "default" : "outline"}>{enabled ? "Enabled" : "Disabled"}</Badge>
                </CardAction>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleSubmit} className="flex flex-col gap-6">
                        <div>
                            <Label htmlFor="obsidian-llm-endpoint">Endpoint URL</Label>
                            <Input
                                type="text"
                                id="obsidian-llm-endpoint"
                                className="mt-2"
                                placeholder="http://localhost:1234/v1/chat/completions"
                                value={endpoint}
                                onChange={(e) => setEndpoint(e.target.value)}
                            />
                            <p className="text-muted-foreground mt-1 text-xs">
                                Default is LM Studio's local server (
                                <code className="bg-foreground/10 rounded px-1">http://localhost:1234/v1/chat/completions</code>
                                ). For Ollama, use its OpenAI-compatible endpoint instead:{" "}
                                <code className="bg-foreground/10 rounded px-1">http://localhost:11434/v1/chat/completions</code>.
                            </p>
                        </div>

                        <div>
                            <Label htmlFor="obsidian-llm-model">Model name</Label>
                            <Input
                                type="text"
                                id="obsidian-llm-model"
                                className="mt-2"
                                placeholder="e.g. llama-3.1-8b-instruct"
                                value={model}
                                onChange={(e) => setModel(e.target.value)}
                            />
                            <p className="text-muted-foreground mt-1 text-xs">
                                Must exactly match a model already loaded/pulled on your local server — there is no
                                default, since it depends entirely on what you have installed.
                            </p>
                        </div>

                        <div>
                            <Label htmlFor="obsidian-llm-timeout">Timeout (milliseconds)</Label>
                            <Input
                                type="number"
                                id="obsidian-llm-timeout"
                                min={1000}
                                step={1000}
                                className="mt-2"
                                placeholder="90000"
                                value={timeoutMs}
                                onChange={(e) => setTimeoutMs(e.target.value)}
                            />
                            <p className="text-muted-foreground mt-1 text-xs">
                                How long to wait for the local server before giving up and saving the plain
                                transcript instead. Default is 90000 (90 seconds) — local models can be slow,
                                especially on the first request.
                            </p>
                        </div>

                        <div>
                            <Button type="submit">Save</Button>
                        </div>

                        <hr />

                        <div>
                            <div className="flex items-center gap-2">
                                <Checkbox
                                    id="use-llm-summary"
                                    checked={enabled}
                                    disabled={checkboxDisabled}
                                    onCheckedChange={(v) => handleEnabledChange(v === true)}
                                />
                                <Label htmlFor="use-llm-summary">Enable local LLM summary enrichment</Label>
                            </div>
                            <p className="text-muted-foreground mt-1 text-xs">
                                Turning this on will prompt Chrome to request permission to contact the endpoint
                                above. This only runs as part of the Obsidian handoff — there's no separate
                                "summarize" button; the cached summary for a past meeting is shown when you expand a
                                meeting on the Meetings page once generated.
                            </p>
                        </div>
                    </form>
                </CardContent>
        </Card>
    )
}
