import { CalendarDays, Video, Plug, Cable, Settings as SettingsIcon } from "lucide-react"
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
import { Separator } from "@/components/ui/separator"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/toast"
import { useActiveView, type ActiveView } from "./use-active-view"
import MeetingsView from "./views/MeetingsView"
import PlatformsView from "./views/PlatformsView"
import IntegrationsView from "./views/IntegrationsView"
import ConnectorsView from "./views/ConnectorsView"
import SettingsView from "./views/SettingsView"
import iconUrl from "../../extension/icon.png"

const NAV_ITEMS: { view: ActiveView; label: string; icon: typeof CalendarDays }[] = [
    { view: "meetings", label: "Meetings", icon: CalendarDays },
    { view: "platforms", label: "Platforms", icon: Video },
    { view: "integrations", label: "Integrations", icon: Plug },
    { view: "connectors", label: "Connectors", icon: Cable },
    { view: "settings", label: "Settings", icon: SettingsIcon },
]

const VIEW_COMPONENTS: Record<ActiveView, React.ComponentType> = {
    meetings: MeetingsView,
    platforms: PlatformsView,
    integrations: IntegrationsView,
    connectors: ConnectorsView,
    settings: SettingsView,
}

export default function App() {
    const { activeView, setActiveView } = useActiveView()
    const ActiveViewComponent = VIEW_COMPONENTS[activeView]

    return (
        <TooltipProvider>
            <Toaster />
            <SidebarProvider>
                <Sidebar>
                    <SidebarHeader>
                        <div className="flex items-center gap-2 px-2 py-1.5">
                            <img src={iconUrl} alt="" className="size-6 rounded-md" />
                            <span className="font-heading text-sm font-bold">TranscripTonic</span>
                        </div>
                    </SidebarHeader>
                    <SidebarContent>
                        <SidebarGroup>
                            <SidebarGroupContent>
                                <SidebarMenu>
                                    {NAV_ITEMS.map((item) => (
                                        <SidebarMenuItem key={item.view}>
                                            <SidebarMenuButton
                                                isActive={activeView === item.view}
                                                onClick={() => setActiveView(item.view)}
                                            >
                                                <item.icon />
                                                <span>{item.label}</span>
                                            </SidebarMenuButton>
                                        </SidebarMenuItem>
                                    ))}
                                </SidebarMenu>
                            </SidebarGroupContent>
                        </SidebarGroup>
                    </SidebarContent>
                    <SidebarFooter>
                        <Separator className="mb-2" />
                        <p className="text-muted-foreground px-2 pb-1 text-xs">
                            Simple Google Meet transcripts. Private and open source.
                        </p>
                    </SidebarFooter>
                </Sidebar>
                <SidebarInset>
                    <header className="flex items-center gap-2 border-b p-3 md:hidden">
                        <SidebarTrigger />
                        <span className="font-heading text-sm font-bold">TranscripTonic</span>
                    </header>
                    <main className="mx-auto w-full max-w-4xl p-4 sm:p-8">
                        <ActiveViewComponent />
                    </main>
                </SidebarInset>
            </SidebarProvider>
        </TooltipProvider>
    )
}
