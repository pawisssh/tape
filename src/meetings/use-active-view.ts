// Tiny hash-based view switcher for the meetings tab's sidebar — deliberately not a
// routing library (the app has exactly four flat views, no nesting/params). The hash is
// kept in sync so the popup's existing `chrome.runtime.getURL("meetings.html") + "#..."`
// deep-links (and the browser back/forward buttons) still land on the right view.
import { useCallback, useEffect, useState } from "react"

export const VIEWS = ["meetings", "platforms", "integrations", "connectors", "settings"] as const
export type ActiveView = (typeof VIEWS)[number]

function viewFromHash(hash: string): ActiveView {
    const candidate = hash.replace(/^#/, "")
    return (VIEWS as readonly string[]).includes(candidate) ? (candidate as ActiveView) : "meetings"
}

export function useActiveView() {
    const [activeView, setActiveViewState] = useState<ActiveView>(() => viewFromHash(window.location.hash))

    useEffect(() => {
        function onHashChange() {
            setActiveViewState(viewFromHash(window.location.hash))
        }
        window.addEventListener("hashchange", onHashChange)
        return () => window.removeEventListener("hashchange", onHashChange)
    }, [])

    const setActiveView = useCallback((view: ActiveView) => {
        setActiveViewState(view)
        window.location.hash = view
    }, [])

    return { activeView, setActiveView }
}
