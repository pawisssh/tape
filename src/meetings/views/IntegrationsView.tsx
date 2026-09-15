import { useEffect, useRef, useState } from "react"
import { Switch } from "@/components/ui/switch"
import { getSync, setSync, onStorageChanged } from "@/lib/chrome-storage"
import { endpointOriginPattern, requestPermissions } from "@/lib/permissions"
import { toast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import MasterDetailLayout from "../components/MasterDetailLayout"
import MobileBackButton from "../components/MobileBackButton"
import ObsidianSection from "../ObsidianSection"
import WebhookSection, { type WebhookSectionHandle } from "../WebhookSection"
import ProviderPanel, { type ProviderPanelHandle } from "../connectors/ProviderPanel"
import AiModelRows from "../connectors/AiModelRows"
import { GoogleMeetIcon, TeamsIcon, ZoomIcon, ObsidianIcon } from "../connectors/brand-icons"
import { KeyboardArrowRightIcon, DnsIcon, WebhookIcon, LinkIcon } from "../ui/icons"
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
    icon: DnsIcon,
    allowedTypes: ["lmstudio", "ollama", "custom"] as ObsidianLlmProviderType[],
}

// Small-caps system-label treatment used everywhere on the Meetings page (sidebar stat
// labels, tab-adjacent labels) — see e.g. SidebarStatusBar.tsx's "Apps"/"AI"/"Storage".
function GroupLabel({ children }: { children: React.ReactNode }) {
    return (
        <div className="px-4 pt-4 pb-1">
            <span className="font-meetings-mono text-[10px] tracking-wide text-meetings-ink-faint uppercase">{children}</span>
        </div>
    )
}

// Matches MeetingListRow.tsx exactly — h-16 row, bg-meetings-chip selected state, no more
// left/right accent border.
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
            className={cn("flex h-16 w-full items-center gap-3 px-4 text-left", selected && "bg-meetings-chip")}
        >
            <Icon className="size-5 shrink-0 text-meetings-ink-muted" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-meetings-ink">{name}</span>
            {status ? <span className="shrink-0 text-xs text-meetings-ink-muted">{status}</span> : null}
            <KeyboardArrowRightIcon className="size-4 shrink-0 text-meetings-ink-faint" />
        </button>
    )
}

// Header-row action button — same solid-pill treatment as Templates' "Add template"
// button (the app's one existing icon+label header button), reused here since there's
// no lighter-weight precedent already in this page's header to match instead.
function HeaderConnectButton({ connecting, disabled, onClick }: { connecting: boolean; disabled: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className="flex h-9 shrink-0 items-center gap-2 rounded-full bg-meetings-ink pr-4 pl-2 text-sm font-medium text-meetings-surface shadow-[0px_16px_16px_rgba(12,12,13,0.1),0px_4px_2px_rgba(12,12,13,0.05)] transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
        >
            <LinkIcon className="size-4" /> {connecting ? "Connecting…" : "Connect"}
        </button>
    )
}

// List (content) + detail panel, same shape as every other page (see
// MasterDetailLayout.tsx). Platform toggles are directly actionable in their own row (no
// detail view); Obsidian/Webhook/AI provider slots are selectable rows whose settings
// render in the detail panel — no more modals on this page.
interface IntegrationsViewProps {
    // Deep-links straight to a specific row's detail panel — see SidebarStatusBar.tsx's
    // Apps/AI/Storage rows, threaded through App.tsx from the "#integrations/<id>" hash
    // (use-active-view.ts). Anything other than a real SelectableId is ignored, so a plain
    // "#integrations" (no row) or a stale/foreign value just leaves selection untouched.
    initialSelectedId?: string | null
}

function isSelectableId(value: string | null | undefined): value is SelectableId {
    return value === "obsidian" || value === "webhook" || value === "ai"
}

export default function IntegrationsView({ initialSelectedId }: IntegrationsViewProps) {
    const googleMeet = usePlatformToggle("google_meet")
    const teams = usePlatformToggle("teams")
    const zoom = usePlatformToggle("zoom")

    const [obsidianConnected, setObsidianConnected] = useState(false)
    const [webhookConnected, setWebhookConnected] = useState(false)
    const [providers, setProviders] = useState<LlmProviderConfig[]>([])
    const [activeModel, setActiveModelState] = useState<ObsidianLlmActiveModel | null>(null)
    const [selectedId, setSelectedId] = useState<SelectableId | null>(
        isSelectableId(initialSelectedId) ? initialSelectedId : null,
    )
    const [mobileDetailOpen, setMobileDetailOpen] = useState(false)

    // Connect buttons for Webhook/AI now live in this page's header (matching the
    // Templates/Meetings header pattern) rather than inside each panel's own body — the
    // panels still own the actual connect logic and expose it via ref + these mirrored
    // "is it connecting / can it connect" states. See WebhookSection.tsx/ProviderPanel.tsx.
    const webhookRef = useRef<WebhookSectionHandle>(null)
    const [webhookConnecting, setWebhookConnecting] = useState(false)
    const [webhookCanConnect, setWebhookCanConnect] = useState(false)
    const providerRef = useRef<ProviderPanelHandle>(null)
    const [aiConnecting, setAiConnecting] = useState(false)

    function selectRow(id: SelectableId) {
        setSelectedId(id)
        setMobileDetailOpen(true)
    }

    // Re-selects whenever the caller's deep-link target changes — not just on mount —
    // since this component doesn't remount when the sidebar sends a new "#integrations/*"
    // hash while the user is already on this page (activeView stays "integrations", only
    // viewParam changes).
    useEffect(() => {
        if (isSelectableId(initialSelectedId)) selectRow(initialSelectedId)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialSelectedId])

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
            className="meetings-redesign"
            contentTitle={<h1 className="font-meetings-heading flex-1 text-xl text-meetings-ink">integrations</h1>}
            content={
                    <div className="flex flex-col">
                        <p className="px-4 pt-4 pb-2 text-sm text-meetings-ink-muted">
                            Connect TranscripTonic to the tools you already use.
                        </p>
                        <GroupLabel>Platforms</GroupLabel>
                        <div className="flex h-16 items-center gap-3 px-4">
                            <GoogleMeetIcon className="size-5 shrink-0" />
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-meetings-ink">Google Meet</span>
                            <Switch
                                checked={googleMeet.checked}
                                disabled={googleMeet.pending}
                                onCheckedChange={googleMeet.toggle}
                            />
                        </div>
                        <div className="flex h-16 items-center gap-3 px-4">
                            <TeamsIcon className="size-5 shrink-0" />
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-meetings-ink">Teams (beta)</span>
                            <Switch checked={teams.checked} disabled={teams.pending} onCheckedChange={teams.toggle} />
                        </div>
                        <div className="flex h-16 items-center gap-3 px-4">
                            <ZoomIcon className="size-5 shrink-0" />
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-meetings-ink">Zoom (beta)</span>
                            <Switch checked={zoom.checked} disabled={zoom.pending} onCheckedChange={zoom.toggle} />
                        </div>

                        <GroupLabel>Storage</GroupLabel>
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
                        <h2 className="font-meetings-heading text-xl text-meetings-ink">Obsidian</h2>
                    </>
                ) : selectedId === "webhook" ? (
                    <>
                        <MobileBackButton onClick={() => setMobileDetailOpen(false)} />
                        <h2 className="font-meetings-heading flex-1 text-xl text-meetings-ink">Webhook</h2>
                        <HeaderConnectButton
                            connecting={webhookConnecting}
                            disabled={webhookConnecting || !webhookCanConnect}
                            onClick={() => webhookRef.current?.connect()}
                        />
                    </>
                ) : selectedId === "ai" ? (
                    <>
                        <MobileBackButton onClick={() => setMobileDetailOpen(false)} />
                        <h2 className="font-meetings-heading flex-1 text-xl text-meetings-ink">{AI_SLOT.name}</h2>
                        <HeaderConnectButton
                            connecting={aiConnecting}
                            disabled={aiConnecting}
                            onClick={() => providerRef.current?.connect()}
                        />
                    </>
                ) : null
            }
            detail={
                selectedId === "obsidian" ? (
                    <div className="px-4">
                        <p className="pt-4 pb-2 text-sm text-meetings-ink-muted">Hand transcripts off as a new note in your vault.</p>
                        <ObsidianSection />
                    </div>
                ) : selectedId === "webhook" ? (
                    <div className="px-4">
                        <p className="pt-4 pb-2 text-sm text-meetings-ink-muted">Post transcripts to any tool that accepts webhooks.</p>
                        <WebhookSection
                            ref={webhookRef}
                            onConnectingChange={setWebhookConnecting}
                            onCanConnectChange={setWebhookCanConnect}
                        />
                    </div>
                ) : selectedId === "ai" ? (
                    <div className="px-4">
                        <p className="pt-4 pb-2 text-sm text-meetings-ink-muted">{AI_SLOT.description}</p>
                        <ProviderPanel
                            key={AI_SLOT.id}
                            ref={providerRef}
                            provider={aiProvider}
                            allowedTypes={AI_SLOT.allowedTypes}
                            onSaved={handleProviderSaved}
                            onDeleted={handleProviderDeleted}
                            onConnectingChange={setAiConnecting}
                        />
                    </div>
                ) : (
                    <p className="px-4 text-sm text-meetings-ink-muted">Select a connector to configure it.</p>
                )
            }
            mobileDetailOpen={mobileDetailOpen}
        />
    )
}
