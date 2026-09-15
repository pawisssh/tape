// Tiny hash-based view switcher for the meetings tab's sidebar — deliberately not a
// routing library (the app has exactly four flat views, no nesting/params beyond the one
// optional sub-target below). The hash is kept in sync so the popup's existing
// `chrome.runtime.getURL("meetings.html") + "#..."` deep-links (and the browser
// back/forward buttons) still land on the right view.
//
// A view may carry one optional "/<param>" segment (e.g. "#integrations/obsidian") — the
// only current use is SidebarStatusBar's Apps/AI/Storage rows deep-linking into a
// specific Integrations row (see IntegrationsView.tsx's `initialSelectedId` prop). Kept
// as a single opaque string rather than typed per-view since only one view uses it today.
import { useCallback, useEffect, useState } from "react"

export const VIEWS = ["meetings", "integrations", "templates", "dictionary", "settings"] as const
export type ActiveView = (typeof VIEWS)[number]

function viewFromHash(hash: string): ActiveView {
    const candidate = hash.replace(/^#/, "").split("/")[0]
    return (VIEWS as readonly string[]).includes(candidate) ? (candidate as ActiveView) : "meetings"
}

function paramFromHash(hash: string): string | null {
    const [, param] = hash.replace(/^#/, "").split("/")
    return param || null
}

export function useActiveView() {
    const [activeView, setActiveViewState] = useState<ActiveView>(() => viewFromHash(window.location.hash))
    const [viewParam, setViewParamState] = useState<string | null>(() => paramFromHash(window.location.hash))

    useEffect(() => {
        function onHashChange() {
            setActiveViewState(viewFromHash(window.location.hash))
            setViewParamState(paramFromHash(window.location.hash))
        }
        window.addEventListener("hashchange", onHashChange)
        return () => window.removeEventListener("hashchange", onHashChange)
    }, [])

    const setActiveView = useCallback((view: ActiveView, param?: string) => {
        setActiveViewState(view)
        setViewParamState(param || null)
        window.location.hash = param ? `${view}/${param}` : view
    }, [])

    return { activeView, viewParam, setActiveView }
}
