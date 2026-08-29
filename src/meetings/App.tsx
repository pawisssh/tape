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
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/toast"
import { getSync, setSync } from "@/lib/chrome-storage"
import { useIsCompactSidebar } from "@/hooks/use-compact-sidebar"
import { useActiveView, type ActiveView } from "./use-active-view"
import SidebarStatusBar from "./ui/SidebarStatusBar"
import { CalendarMonthIcon, CableIcon, DescriptionIcon, SettingsIconMS } from "./ui/icons"
import MeetingsView from "./views/MeetingsView"
import IntegrationsView from "./views/IntegrationsView"
import TemplatesView from "./views/TemplatesView"
import SettingsView from "./views/SettingsView"
import logoUrl from "../../assets/img-logo-tape-default.svg"

const NAV_ITEMS: { view: ActiveView; label: string; icon: typeof CalendarMonthIcon }[] = [
    { view: "meetings", label: "Meetings", icon: CalendarMonthIcon },
    { view: "integrations", label: "Integrations", icon: CableIcon },
    { view: "templates", label: "Templates", icon: DescriptionIcon },
    { view: "settings", label: "Settings", icon: SettingsIconMS },
]

const VIEW_COMPONENTS: Record<ActiveView, React.ComponentType> = {
    meetings: MeetingsView,
    integrations: IntegrationsView,
    templates: TemplatesView,
    settings: SettingsView,
}

export default function App() {
    const { activeView, setActiveView } = useActiveView()
    const ActiveViewComponent = VIEW_COMPONENTS[activeView]

    // Auto-collapses the sidebar to its icon rail below ~1024px (no manual toggle on
    // desktop — purely width-driven). Kept from before the redesign; only the visual
    // treatment of the expanded/collapsed states changed, not this behavior.
    const isCompact = useIsCompactSidebar()
    const [sidebarOpen, setSidebarOpen] = useState(true)
    useEffect(() => {
        setSidebarOpen(!isCompact)
    }, [isCompact])

    const [autoCaptureEnabled, setAutoCaptureEnabled] = useState(true)
    useEffect(() => {
        getSync<ResultSync>(["autoCaptureEnabled"]).then((result) => {
            setAutoCaptureEnabled(result.autoCaptureEnabled !== false)
        })
    }, [])
    function handleAutoCaptureChange(checked: boolean) {
        setAutoCaptureEnabled(checked)
        setSync({ autoCaptureEnabled: checked })
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
                                className="h-[22px] w-12 shrink-0 group-data-[collapsible=icon]:h-4 group-data-[collapsible=icon]:w-auto"
                            />
                            <span className="flex-1 group-data-[collapsible=icon]:hidden" />
                            <Switch
                                checked={autoCaptureEnabled}
                                onCheckedChange={handleAutoCaptureChange}
                                className="h-6 w-12 data-checked:bg-meetings-accent group-data-[collapsible=icon]:hidden"
                                aria-label="Auto-capture meetings"
                            />
                        </div>
                    </SidebarHeader>
                    <div className="group-data-[collapsible=icon]:hidden">
                        <SidebarStatusBar autoCaptureEnabled={autoCaptureEnabled} />
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
                                                    <span
                                                        className={cn(
                                                            "flex size-6 shrink-0 items-center justify-center",
                                                            active
                                                                ? "bg-meetings-ink text-meetings-surface"
                                                                : "bg-meetings-chip-neutral text-meetings-ink-faint",
                                                        )}
                                                    >
                                                        <item.icon className="size-4" />
                                                    </span>
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
                        <ActiveViewComponent />
                    </main>
                </SidebarInset>
            </SidebarProvider>
        </TooltipProvider>
    )
}
