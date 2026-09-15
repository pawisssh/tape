import { useEffect, useState } from "react"
import { getLocal, getSync, onStorageChanged } from "@/lib/chrome-storage"
import { sendMessage } from "@/lib/messaging"
import { cn } from "@/lib/utils"
import { useLiveCaptureState } from "../use-live-capture-state"
import type { ActiveView } from "../use-active-view"
import { PlayArrowFillIcon, CheckCircleFillIcon, CircleFillIcon } from "./icons"

const PLATFORMS: { platform: Platform; label: string }[] = [
    { platform: "google_meet", label: "G" },
    { platform: "teams", label: "T" },
    { platform: "zoom", label: "Z" },
]

interface SidebarStatusBarProps {
    // Drives the record-dot's color below — orange (auto), white (manual), dim (off) —
    // and its label. Same "operationMode" sync setting the popup/Settings page's capture
    // mode radio group reads and writes (see App.tsx, which owns the state and its
    // onStorageChanged listener; not re-read here, so there's exactly one source of truth).
    operationMode: OperationMode
    // Drives the Apps/AI/Storage rows below — each jumps to the Integrations page, AI and
    // Storage deep-linking straight to their row's detail panel (see
    // IntegrationsView.tsx's `initialSelectedId` prop / use-active-view.ts's optional hash
    // param). Passed down from App.tsx's own `setActiveView` rather than this component
    // calling useActiveView() itself, so there's exactly one hash-reading hook instance.
    onNavigate: (view: ActiveView, param?: string) => void
}

// The sidebar's black "recording bar": a live capture indicator (record-dot, real —
// see use-live-capture-state.ts) plus a status dashboard (APPS/AI/STORAGE, all backed
// by existing settings — no new storage keys except what the caller already tracks).
// The play icon is rendered per the design but deliberately non-functional this pass —
// wiring a remote manual-capture-start into extension/content-scripts/* is separate,
// higher-risk scope (see the plan doc).
export default function SidebarStatusBar({ operationMode, onNavigate }: SidebarStatusBarProps) {
    const { isCapturing, isProcessing } = useLiveCaptureState()
    const [platformEnabled, setPlatformEnabled] = useState<Partial<Record<Platform, boolean>>>({})
    const [activeModelId, setActiveModelId] = useState<string | null>(null)
    const [obsidianConfigured, setObsidianConfigured] = useState(false)

    useEffect(() => {
        function loadPlatforms() {
            sendMessage({
                type: "get_platform_enablement_status",
                platform: PLATFORMS.map((p) => p.platform),
            }).then((response) => {
                if (!response.success || !Array.isArray(response.message)) return
                const next: Partial<Record<Platform, boolean>> = {}
                PLATFORMS.forEach((p, i) => {
                    next[p.platform] = response.message[i] === "Enabled"
                })
                setPlatformEnabled(next)
            })
        }
        loadPlatforms()
        return onStorageChanged((changes, area) => {
            if (area === "sync" && (changes.wantGoogleMeet || changes.wantTeams || changes.wantZoom)) {
                loadPlatforms()
            }
        })
    }, [])

    useEffect(() => {
        function loadModel() {
            getLocal<ResultLocal>(["obsidianLlmActiveModel"]).then((result) => {
                setActiveModelId(result.obsidianLlmActiveModel?.modelId || null)
            })
        }
        loadModel()
        return onStorageChanged((changes, area) => {
            if (area === "local" && changes.obsidianLlmActiveModel) loadModel()
        })
    }, [])

    useEffect(() => {
        function loadObsidianStatus() {
            getSync<ResultSync>(["obsidianVaultName"]).then((result) => setObsidianConfigured(!!result.obsidianVaultName))
        }
        loadObsidianStatus()
        return onStorageChanged((changes, area) => {
            if (area === "sync" && changes.obsidianVaultName) loadObsidianStatus()
        })
    }, [])

    return (
        <div className="flex flex-col bg-black">
            <div className="flex h-16 items-center px-4">
                <CircleFillIcon
                    aria-label={
                        operationMode === "off"
                            ? "Capture is off"
                            : isCapturing
                                ? "Capturing a meeting"
                                : isProcessing
                                    ? "Processing…"
                                    : operationMode === "manual"
                                        ? "Manual capture"
                                        : "Auto capture"
                    }
                    className={cn(
                        "size-4 shrink-0",
                        operationMode === "off" ? "text-white/38" : operationMode === "manual" ? "text-white" : "text-meetings-accent",
                    )}
                />
                <PlayArrowFillIcon className="size-6 shrink-0 text-white/38" />
            </div>
            <div className="flex h-16 items-center">
                <button
                    type="button"
                    onClick={() => onNavigate("integrations")}
                    className="flex flex-1 flex-col justify-center gap-1 px-4 text-left transition-colors hover:bg-white/5"
                >
                    <span className="font-meetings-mono text-[10px] tracking-wide text-white/38 uppercase">Apps</span>
                    <div className="flex items-center gap-1">
                        {PLATFORMS.map((p) => (
                            <span
                                key={p.platform}
                                className={cn(
                                    "font-meetings-heading flex size-5 items-center justify-center text-[10px]",
                                    platformEnabled[p.platform] ? "bg-white text-black/87" : "bg-white/12 text-white/12",
                                )}
                            >
                                {p.label}
                            </span>
                        ))}
                    </div>
                </button>
                <button
                    type="button"
                    onClick={() => onNavigate("integrations", "ai")}
                    className="flex min-w-0 flex-1 flex-col justify-center gap-1 px-4 text-left transition-colors hover:bg-white/5"
                >
                    <span className="font-meetings-mono text-[10px] tracking-wide text-white/38 uppercase">AI</span>
                    <div
                        className={cn(
                            "flex h-5 w-full min-w-0 items-center border px-1",
                            activeModelId ? "border-meetings-accent" : "border-white/38",
                        )}
                    >
                        <span
                            className={cn(
                                "font-meetings-heading min-w-0 flex-1 truncate text-[10px]",
                                activeModelId ? "text-white" : "text-white/38",
                            )}
                        >
                            {activeModelId || "NOT SET"}
                        </span>
                    </div>
                </button>
                <button
                    type="button"
                    onClick={() => onNavigate("integrations", "obsidian")}
                    className="flex flex-1 flex-col justify-center gap-1 px-4 text-left transition-colors hover:bg-white/5"
                >
                    <span className="font-meetings-mono text-[10px] tracking-wide text-white/38 uppercase">Storage</span>
                    {obsidianConfigured ? (
                        <CheckCircleFillIcon className="size-5 text-white" />
                    ) : (
                        <span className="font-meetings-heading text-[10px] text-white/38">NOT SET</span>
                    )}
                </button>
            </div>
        </div>
    )
}
