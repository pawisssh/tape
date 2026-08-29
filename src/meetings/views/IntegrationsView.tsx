import { useEffect, useState } from "react"
import { ChevronRight, Server, Webhook as WebhookIcon } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { getSync, setSync, onStorageChanged } from "@/lib/chrome-storage"
import { endpointOriginPattern, requestPermissions } from "@/lib/permissions"
import { toast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import MasterDetailLayout from "../components/MasterDetailLayout"
import MobileBackButton from "../components/MobileBackButton"
import ObsidianSection from "../ObsidianSection"
import WebhookSection from "../WebhookSection"
import ProviderPanel from "../connectors/ProviderPanel"
import AiModelRows from "../connectors/AiModelRows"
import { GoogleMeetIcon, TeamsIcon, ZoomIcon, ObsidianIcon } from "../connectors/brand-icons"
import { usePlatformToggle } from "@/lib/use-platform-toggle"
// Framework-free logic module, imported directly rather than duplicated into src/ — see
// PLAN.md §6 Phase 5 "Structural rule to preserve". getProviders/getActiveModel/
// setActiveModel are the single source of truth for the multi-provider connector list,
// also used by extension/obsidian/store.js.
import { getProviders, getActiveModel, setActiveModel } from "../../../extension/obsidian/providers.js"

type SelectableId = "obsidian" | "webhook" | "ai"

const AI_SLOT = {
    id: "ai" as const,
    name: "Local/Custom endpoints",
    description: "Run models locally with LM Studio or Ollama, or point at any other OpenAI-compatible endpoint",
    icon: Server,
    allowedTypes: ["lmstudio", "ollama", "custom"] as ObsidianLlmProviderType[],
}

// Matches the day-group headers on the Meetings page (see MeetingsView.tsx) — same
// bg-muted/40 row, same text-sm font-bold label, for visual consistency between the two
// pages' list-section headers.
function GroupLabel({ children }: { children: React.ReactNode }) {
    return (
        <div className="bg-muted/40 flex items-center px-4 py-1.5">
            <span className="text-sm font-bold">{children}</span>
        </div>
    )
}

function ListRow({
    icon: Icon,
    name,
    status,
    selected,
    onClick,
}: {
    icon: React.ComponentType<{ className?: string }>
    name: string
    status?: string
    selected: boolean
    onClick: () => void
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                "flex w-full items-center gap-3 border-r-[3px] border-r-transparent py-3 pr-[13px] pl-4 text-left text-sm hover:bg-muted/50",
                selected && "border-r-primary bg-muted",
            )}
        >
            <Icon className="size-5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{name}</span>
            {status ? <span className="text-muted-foreground shrink-0 text-xs">{status}</span> : null}
            <ChevronRight className="text-muted-foreground size-4 shrink-0" />
        </button>
    )
}

// List (content) + detail panel, same shape as every other page (see
// MasterDetailLayout.tsx). Platform toggles are directly actionable in their own row (no
// detail view); Obsidian/Webhook/AI provider slots are selectable rows whose settings
// render in the detail panel — no more modals on this page.
export default function IntegrationsView() {
    const googleMeet = usePlatformToggle("google_meet")
    const teams = usePlatformToggle("teams")
    const zoom = usePlatformToggle("zoom")

    const [obsidianConnected, setObsidianConnected] = useState(false)
    const [webhookConnected, setWebhookConnected] = useState(false)
    const [providers, setProviders] = useState<LlmProviderConfig[]>([])
    const [activeModel, setActiveModelState] = useState<ObsidianLlmActiveModel | null>(null)
    const [selectedId, setSelectedId] = useState<SelectableId | null>(null)
    const [mobileDetailOpen, setMobileDetailOpen] = useState(false)

    function selectRow(id: SelectableId) {
        setSelectedId(id)
        setMobileDetailOpen(true)
    }

    useEffect(() => {
        function loadStatus() {
            getSync<ResultSync>(["obsidianVaultName", "webhookUrl"]).then((result) => {
                setObsidianConnected(!!result.obsidianVaultName)
                setWebhookConnected(!!result.webhookUrl)
            })
        }
        loadStatus()
        return onStorageChanged((changes, area) => {
            if (area === "sync" && (changes.obsidianVaultName || changes.webhookUrl)) loadStatus()
        })
    }, [])

    useEffect(() => {
        Promise.all([getProviders(), getActiveModel()]).then(([loadedProviders, loadedActiveModel]) => {
            setProviders(loadedProviders)
            setActiveModelState(loadedActiveModel)
        })
    }, [])

    // Fires from a model row's own Switch click inside the embedded ModelsCard — the
    // right place to request host permission (a genuine user gesture, and the first
    // point we actually know which origin needs it).
    function handleActiveModelChanged(next: ObsidianLlmActiveModel | null) {
        setActiveModelState(next)
        setActiveModel(next)

        if (!next) return

        // Picking an active model is the point AI summarization actually becomes
        // functional (a provider alone isn't enough — see getObsidianSettings in
        // extension/obsidian/store.js), so flip Settings' "Enable LLM summary" on here
        // too rather than leaving the user to notice and toggle it separately. Only turns
        // it on, never off — deactivating a model shouldn't silently override a choice the
        // user made explicitly in Settings.
        setSync({ obsidianUseLlm: true })

        const provider = providers.find((p) => p.id === next.providerId)
        if (!provider) return

        const originPattern = endpointOriginPattern(provider.baseUrl)
        if (!originPattern) {
            toast.add({ title: "Invalid provider base URL", type: "warning" })
            return
        }
        requestPermissions([originPattern])
            .then((granted) => {
                if (!granted) {
                    toast.add({
                        title: "Permission not granted",
                        description: `Summaries won't work against ${provider.name} until this permission is granted.`,
                        type: "warning",
                    })
                }
            })
            .catch((error) => {
                console.error("LLM provider permission error:", error)
            })
    }

    function handleProviderSaved(saved: LlmProviderConfig) {
        setProviders((prev) => (prev.some((p) => p.id === saved.id) ? prev.map((p) => (p.id === saved.id ? saved : p)) : [...prev, saved]))
    }

    function handleProviderDeleted(id: string) {
        setProviders((prev) => prev.filter((p) => p.id !== id))
        if (activeModel?.providerId === id) setActiveModelState(null)
    }

    const aiProvider = providers.find((p) => AI_SLOT.allowedTypes.includes(p.type)) ?? null

    return (
        <MasterDetailLayout
            contentTitle={<h1 className="text-xl font-bold">Integrations</h1>}
            content={
                    <div className="flex flex-col">
                        <p className="text-muted-foreground px-4 pt-4 pb-2 text-sm">
                            Connect TranscripTonic to the tools you already use.
                        </p>
                        <GroupLabel>Platforms</GroupLabel>
                        <div className="flex items-center gap-3 border-r-[3px] border-r-transparent py-3 pr-[13px] pl-4">
                            <GoogleMeetIcon className="size-5 shrink-0" />
                            <span className="min-w-0 flex-1 truncate text-sm">Google Meet</span>
                            <Switch
                                checked={googleMeet.checked}
                                disabled={googleMeet.pending}
                                onCheckedChange={googleMeet.toggle}
                            />
                        </div>
                        <div className="flex items-center gap-3 border-r-[3px] border-r-transparent py-3 pr-[13px] pl-4">
                            <TeamsIcon className="size-5 shrink-0" />
                            <span className="min-w-0 flex-1 truncate text-sm">Teams</span>
                            <Switch checked={teams.checked} disabled={teams.pending} onCheckedChange={teams.toggle} />
                        </div>
                        <div className="flex items-center gap-3 border-r-[3px] border-r-transparent py-3 pr-[13px] pl-4">
                            <ZoomIcon className="size-5 shrink-0" />
                            <span className="min-w-0 flex-1 truncate text-sm">Zoom</span>
                            <Switch checked={zoom.checked} disabled={zoom.pending} onCheckedChange={zoom.toggle} />
                        </div>

                        <GroupLabel>Connectors</GroupLabel>
                        <ListRow
                            icon={ObsidianIcon}
                            name="Obsidian"
                            status={obsidianConnected ? "Connected" : "Not configured"}
                            selected={selectedId === "obsidian"}
                            onClick={() => selectRow("obsidian")}
                        />

                        <GroupLabel>AI Providers</GroupLabel>
                        <ListRow
                            icon={AI_SLOT.icon}
                            name={AI_SLOT.name}
                            status={aiProvider ? "Connected" : "Not configured"}
                            selected={selectedId === "ai"}
                            onClick={() => selectRow("ai")}
                        />
                        {aiProvider ? (
                            <AiModelRows provider={aiProvider} activeModel={activeModel} onActiveModelChanged={handleActiveModelChanged} />
                        ) : null}

                        <GroupLabel>Advanced</GroupLabel>
                        <ListRow
                            icon={WebhookIcon}
                            name="Webhook"
                            status={webhookConnected ? "Connected" : "Not configured"}
                            selected={selectedId === "webhook"}
                            onClick={() => selectRow("webhook")}
                        />
                    </div>
            }
            detailTitle={
                selectedId === "obsidian" ? (
                    <>
                        <MobileBackButton onClick={() => setMobileDetailOpen(false)} />
                        <h2 className="text-xl font-bold">Obsidian</h2>
                    </>
                ) : selectedId === "webhook" ? (
                    <>
                        <MobileBackButton onClick={() => setMobileDetailOpen(false)} />
                        <h2 className="text-xl font-bold">Webhook</h2>
                    </>
                ) : selectedId === "ai" ? (
                    <>
                        <MobileBackButton onClick={() => setMobileDetailOpen(false)} />
                        <h2 className="text-xl font-bold">{AI_SLOT.name}</h2>
                    </>
                ) : null
            }
            detail={
                selectedId === "obsidian" ? (
                    <div className="px-4">
                        <p className="text-muted-foreground pt-4 pb-2 text-sm">Hand transcripts off as a new note in your vault.</p>
                        <ObsidianSection />
                    </div>
                ) : selectedId === "webhook" ? (
                    <div className="px-4">
                        <p className="text-muted-foreground pt-4 pb-2 text-sm">Post transcripts to any tool that accepts webhooks.</p>
                        <WebhookSection />
                    </div>
                ) : selectedId === "ai" ? (
                    <div className="px-4">
                        <p className="text-muted-foreground pt-4 pb-2 text-sm">{AI_SLOT.description}</p>
                        <ProviderPanel
                            key={AI_SLOT.id}
                            provider={aiProvider}
                            allowedTypes={AI_SLOT.allowedTypes}
                            onSaved={handleProviderSaved}
                            onDeleted={handleProviderDeleted}
                        />
                    </div>
                ) : (
                    <p className="text-muted-foreground px-4 text-sm">Select a connector to configure it.</p>
                )
            }
            mobileDetailOpen={mobileDetailOpen}
        />
    )
}
