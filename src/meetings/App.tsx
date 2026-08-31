import { useEffect, useState } from "react"
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarHeader,
    SidebarInset,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarProvider,
    SidebarTrigger,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/toast"
import { getSync, setSync, onStorageChanged } from "@/lib/chrome-storage"
import { useIsCompactSidebar } from "@/hooks/use-compact-sidebar"
import { useActiveView, type ActiveView } from "./use-active-view"
import SidebarStatusBar from "./ui/SidebarStatusBar"
import OperationModeToggle from "./ui/OperationModeToggle"
import { EventNoteIcon, SpokeIcon, LayersIcon, SettingsIconMS } from "./ui/icons"
import MeetingsView from "./views/MeetingsView"
import IntegrationsView from "./views/IntegrationsView"
import TemplatesView from "./views/TemplatesView"
import SettingsView from "./views/SettingsView"
import logoUrl from "../../assets/img-logo-tape-default.svg"
import logoDarkUrl from "../../assets/img-logo-tape-on-dark-default.svg"

const NAV_ITEMS: { view: ActiveView; label: string; icon: typeof EventNoteIcon }[] = [
    { view: "meetings", label: "Meetings", icon: EventNoteIcon },
    { view: "integrations", label: "Integrations", icon: SpokeIcon },
    { view: "templates", label: "Templates", icon: LayersIcon },
    { view: "settings", label: "Settings", icon: SettingsIconMS },
]

const VIEW_COMPONENTS: Record<ActiveView, React.ComponentType> = {
    meetings: MeetingsView,
    integrations: IntegrationsView,
    templates: TemplatesView,
    settings: SettingsView,
}

export default function App() {
    const { activeView, viewParam, setActiveView } = useActiveView()
    const ActiveViewComponent = VIEW_COMPONENTS[activeView]

    // Auto-collapses the sidebar to its icon rail below ~1024px (no manual toggle on
    // desktop — purely width-driven). Kept from before the redesign; only the visual
    // treatment of the expanded/collapsed states changed, not this behavior.
    const isCompact = useIsCompactSidebar()
    const [sidebarOpen, setSidebarOpen] = useState(true)
    useEffect(() => {
        setSidebarOpen(!isCompact)
    }, [isCompact])

    // Single source of truth for capture mode — also read/written by the popup and
    // Settings page's radio group (see SettingsView.tsx/popup/App.tsx) and the sidebar
    // record-dot below (SidebarStatusBar.tsx). The onStorageChanged listener (not just a
    // one-time read) is what keeps the sidebar Switch in sync when the mode is changed
    // from one of those other pages instead of here.
    const [operationMode, setOperationModeState] = useState<OperationMode>("auto")
    useEffect(() => {
        function load() {
            getSync<ResultSync>(["operationMode"]).then((result) => {
                setOperationModeState(result.operationMode === "manual" ? "manual" : result.operationMode === "off" ? "off" : "auto")
            })
        }
        load()
        return onStorageChanged((changes, area) => {
            if (area === "sync" && changes.operationMode) load()
        })
    }, [])
    function handleOperationModeChange(mode: OperationMode) {
        setOperationModeState(mode)
        setSync({ operationMode: mode })
    }

    return (
        <TooltipProvider>
            <Toaster />
            {/* transform-gpu is load-bearing, not decorative: Sidebar's actual panel renders
                `position: fixed; left: 0`, which without a transformed ancestor pins to the
                real browser viewport edge — ignoring this wrapper's max-width/centering
                entirely on any window wider than 1440px. Any non-"none" CSS transform on an
                ancestor makes fixed descendants position relative to it instead. */}
            <SidebarProvider
                open={sidebarOpen}
                onOpenChange={setSidebarOpen}
                className="relative mx-auto h-svh max-w-[1440px] transform-gpu overflow-hidden"
                style={
                    {
                        "--sidebar-width": "20rem",
                        "--sidebar-width-icon": "4rem",
                    } as React.CSSProperties
                }
            >
                <Sidebar collapsible="icon" className="meetings-redesign">
                    <SidebarHeader className="h-16 justify-center border-none p-0">
                        <div className="flex min-w-0 items-center gap-2 px-4">
                            <img
                                src={logoUrl}
                                alt=""
                                className="h-[22px] w-12 shrink-0 dark:hidden group-data-[collapsible=icon]:h-4 group-data-[collapsible=icon]:w-auto"
                            />
                            <img
                                src={logoDarkUrl}
                                alt=""
                                className="hidden h-[22px] w-12 shrink-0 dark:block group-data-[collapsible=icon]:h-4 group-data-[collapsible=icon]:w-auto"
                            />
                            <span className="flex-1 group-data-[collapsible=icon]:hidden" />
                            <OperationModeToggle
                                value={operationMode}
                                onChange={handleOperationModeChange}
                                className="group-data-[collapsible=icon]:hidden"
                            />
                        </div>
                    </SidebarHeader>
                    <div className="group-data-[collapsible=icon]:hidden">
                        <SidebarStatusBar operationMode={operationMode} onNavigate={setActiveView} />
                    </div>
                    <SidebarContent>
                        <SidebarGroup className="p-0">
                            <SidebarGroupContent>
                                <SidebarMenu className="gap-0 py-2">
                                    {NAV_ITEMS.map((item) => {
                                        const active = activeView === item.view
                                        return (
                                            <SidebarMenuItem key={item.view}>
                                                <SidebarMenuButton
                                                    size="lg"
                                                    className="h-12 rounded-none px-4 not-data-[active=true]:hover:bg-meetings-chip data-[active=true]:bg-transparent group-data-[collapsible=icon]:mx-2"
                                                    isActive={active}
                                                    onClick={() => setActiveView(item.view)}
                                                    tooltip={item.label}
                                                >
                                                    <item.icon
                                                        className={cn("size-6! shrink-0", active ? "text-meetings-ink" : "text-meetings-ink-faint")}
                                                    />
                                                    <span
                                                        className={cn(
                                                            "font-meetings-heading text-base font-medium uppercase group-data-[collapsible=icon]:hidden",
                                                            active ? "text-meetings-ink" : "text-meetings-ink-faint",
                                                        )}
                                                    >
                                                        {item.label}
                                                    </span>
                                                </SidebarMenuButton>
                                            </SidebarMenuItem>
                                        )
                                    })}
                                </SidebarMenu>
                            </SidebarGroupContent>
                        </SidebarGroup>
                    </SidebarContent>
                    <SidebarFooter className="h-16" />
                </Sidebar>
                <SidebarInset className="overflow-hidden">
                    <header className="flex shrink-0 items-center gap-2 border-b p-3 md:hidden">
                        <SidebarTrigger />
                        <span className="font-heading text-sm font-bold">TranscripTonic</span>
                    </header>
                    <main className="min-h-0 w-full flex-1 overflow-hidden">
                        {activeView === "integrations" ? (
                            <IntegrationsView initialSelectedId={viewParam} />
                        ) : (
                            <ActiveViewComponent />
                        )}
                    </main>
                </SidebarInset>
            </SidebarProvider>
        </TooltipProvider>
    )
}
