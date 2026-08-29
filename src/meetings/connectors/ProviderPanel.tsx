import { useState } from "react"
import { Link2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "@/components/ui/toast"
import { endpointOriginPattern, requestPermissions } from "@/lib/permissions"
import { useDebouncedEffect } from "@/hooks/use-debounced-effect"
// Framework-free logic module, imported directly rather than duplicated into src/ — the
// single source of truth for provider CRUD, also used by extension/obsidian/store.js.
import { saveProvider, deleteProvider, PROVIDER_PRESETS } from "../../../extension/obsidian/providers.js"

const PROVIDER_TYPE_LABELS: Record<ObsidianLlmProviderType, string> = {
    lmstudio: "LM Studio",
    ollama: "Ollama",
    custom: "Custom",
}

function presetFor(type: ObsidianLlmProviderType) {
    return type === "custom" ? { name: "", baseUrl: "" } : PROVIDER_PRESETS[type]
}

interface ProviderPanelProps {
    provider: LlmProviderConfig | null // null = add mode, otherwise editing this provider
    onSaved: (provider: LlmProviderConfig) => void
    onDeleted: (id: string) => void
    // Which provider types this slot can hold — a single entry hides the type picker
    // entirely (the slot only ever means one thing); more than one shows a picker
    // restricted to just those types (e.g. "Local/Custom endpoints" covers LM Studio,
    // Ollama, and Custom).
    allowedTypes: ObsidianLlmProviderType[]
}

// Rendered directly in the Integrations page's detail panel (see IntegrationsView.tsx) —
// no Dialog/modal chrome and no heading of its own (IntegrationsView renders the slot's
// name/description as the detail column's sticky `detailTitle`, see MasterDetailLayout).
// Just the connection form + delete — the model list moved to the content column (see
// AiModelRows.tsx), nested under this slot's row there instead of living here. The parent
// remounts this (via a `key` tied to the selected slot) whenever the user switches which
// provider slot is selected, so initial state can just read from props once rather than
// reacting to prop changes after mount. The delete-confirmation stays an actual small
// Dialog — a destructive-confirm popup interrupting a master-detail page is normal, unlike
// a full settings-form modal.
export default function ProviderPanel({ provider, onSaved, onDeleted, allowedTypes }: ProviderPanelProps) {
    const [type, setType] = useState<ObsidianLlmProviderType>(provider?.type ?? allowedTypes[0])
    const [name, setName] = useState(provider?.name ?? presetFor(allowedTypes[0]).name)
    const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? presetFor(allowedTypes[0]).baseUrl)
    const [apiKey, setApiKey] = useState(provider?.apiKey || "")
    const [isConnecting, setIsConnecting] = useState(false)
    const [confirmingDelete, setConfirmingDelete] = useState(false)

    function handleTypeChange(value: string) {
        const next = allowedTypes.includes(value as ObsidianLlmProviderType) ? (value as ObsidianLlmProviderType) : allowedTypes[0]
        setType(next)
        if (next !== "custom") {
            setName(PROVIDER_PRESETS[next].name)
            setBaseUrl(PROVIDER_PRESETS[next].baseUrl)
        }
    }

    function handleDelete() {
        if (!provider) return
        const id = provider.id
        setConfirmingDelete(false)
        deleteProvider(id).then(() => {
            onDeleted(id)
            toast.add({ title: "Provider deleted", type: "success" })
        })
    }

    // Autosave: name/apiKey/type/baseUrl persist (debounced) as they're edited, skipped
    // while name or baseUrl is blank (matches the old handleSave's validation — no
    // warning toast per keystroke, it just isn't saveable yet). Deliberately does NOT
    // request the host permission below — that has to stay tied to an explicit click
    // (handleConnect), since Chrome refuses chrome.permissions.request() calls made
    // outside a genuine user gesture, and a debounce timer doesn't count as one.
    useDebouncedEffect(
        () => {
            const trimmedName = name.trim()
            const trimmedBaseUrl = baseUrl.trim().replace(/\/+$/, "")
            if (!trimmedName || !trimmedBaseUrl) return
            saveProvider({
                id: provider?.id,
                type,
                name: trimmedName,
                baseUrl: trimmedBaseUrl,
                apiKey: apiKey.trim() || undefined,
            }).then((saved: LlmProviderConfig) => onSaved(saved))
        },
        [name, apiKey, baseUrl, type],
        700,
    )

    // Explicit click only — see the autosave effect above for why this can't be folded
    // into it. Also serves as "reconnect" if permission was revoked or the URL changed
    // since the last grant; requesting again when already granted is a harmless no-op.
    function handleConnect() {
        const trimmedName = name.trim()
        // Strip a trailing slash so every caller can uniformly build
        // `${baseUrl}/chat/completions` / `${baseUrl}/models` without a double slash.
        const trimmedBaseUrl = baseUrl.trim().replace(/\/+$/, "")
        if (!trimmedName || !trimmedBaseUrl) {
            toast.add({ title: "Name and base URL are required", type: "warning" })
            return
        }

        setIsConnecting(true)

        // Chrome only allows fetch() to reach this origin once the extension holds the
        // (optional, "*://*/*") host permission for it — the Models list below fetches
        // immediately after saving, so without this the request fails silently and the
        // list just says "Couldn't reach any configured provider" even with a correct
        // URL. Must fire from this click handler, a genuine user gesture — Chrome
        // refuses chrome.permissions.request() calls made outside one.
        const originPattern = endpointOriginPattern(trimmedBaseUrl)
        const permissionRequest = originPattern ? requestPermissions([originPattern]) : Promise.resolve(true)

        permissionRequest
            .then((granted) => {
                if (!granted) {
                    toast.add({
                        title: "Permission not granted",
                        description: "The model list and summaries won't work against this URL until permission is granted.",
                        type: "warning",
                    })
                }
                return saveProvider({
                    id: provider?.id,
                    type,
                    name: trimmedName,
                    baseUrl: trimmedBaseUrl,
                    apiKey: apiKey.trim() || undefined,
                })
            })
            .then((saved: LlmProviderConfig) => {
                setIsConnecting(false)
                onSaved(saved)
                toast.add({ title: provider ? "Provider updated" : "Provider added", type: "success" })
            })
    }

    return (
        <>
            <div className="flex flex-col gap-4">
                {allowedTypes.length > 1 ? (
                    <div>
                        <Label>Provider</Label>
                        <Select value={type} onValueChange={handleTypeChange}>
                            <SelectTrigger className="mt-2 w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {allowedTypes.map((t) => (
                                    <SelectItem key={t} value={t}>
                                        {PROVIDER_TYPE_LABELS[t]}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                ) : null}

                <div>
                    <Label htmlFor="provider-name">Provider name</Label>
                    <Input
                        id="provider-name"
                        className="mt-2"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Provider name"
                    />
                </div>

                <div>
                    <Label htmlFor="provider-base-url">Base URL</Label>
                    <Input
                        id="provider-base-url"
                        className="mt-2"
                        value={baseUrl}
                        onChange={(e) => setBaseUrl(e.target.value)}
                        placeholder="Base URL"
                    />
                </div>

                <div>
                    <Label htmlFor="provider-api-key">API key</Label>
                    <p className="text-muted-foreground mt-1 mb-2 text-xs">
                        Optional — required by most cloud providers, not needed for a local server.
                    </p>
                    <Input
                        id="provider-api-key"
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="API key"
                    />
                </div>
            </div>

            <div className="mt-4 flex items-center justify-between">
                {provider ? (
                    <Button
                        type="button"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setConfirmingDelete(true)}
                    >
                        Delete
                    </Button>
                ) : (
                    <span />
                )}
                <Button type="button" variant="outline" disabled={isConnecting} onClick={handleConnect}>
                    <Link2 /> {isConnecting ? "Connecting…" : "Connect"}
                </Button>
            </div>

            <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete "{provider?.name}"?</DialogTitle>
                        <DialogDescription>
                            If this provider backs the currently active model, summarization turns off until you pick a
                            new one.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmingDelete(false)}>
                            Cancel
                        </Button>
                        <Button variant="destructive" onClick={handleDelete}>
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
