// Shared by the popup and the meetings tab's Platforms view — extracted so both surfaces
// read/write the exact same chrome.storage.sync + background-script message contract
// instead of maintaining two copies of this logic.
import { useEffect, useState } from "react"
import { setSync } from "@/lib/chrome-storage"
import { sendMessage } from "@/lib/messaging"

type PlatformKey = "google_meet" | "teams" | "zoom"

const PLATFORM_STORAGE_KEY: Record<PlatformKey, "wantGoogleMeet" | "wantTeams" | "wantZoom"> = {
    google_meet: "wantGoogleMeet",
    teams: "wantTeams",
    zoom: "wantZoom",
}

export function usePlatformToggle(platform: PlatformKey) {
    const [checked, setChecked] = useState(false)
    const [pending, setPending] = useState(true)

    useEffect(() => {
        let cancelled = false
        sendMessage({ type: "get_platform_enablement_status", platform }).then((response) => {
            if (cancelled) return
            setPending(false)
            if (response.success) {
                setChecked(response.message === "Enabled")
            }
        })
        return () => {
            cancelled = true
        }
    }, [platform])

    const toggle = (next: boolean) => {
        setChecked(next)
        setSync({ [PLATFORM_STORAGE_KEY[platform]]: next })
        sendMessage({ type: next ? "enable_platform" : "disable_platform", platform }).then((response) => {
            if (!response.success) {
                // Revert on failure — matches upstream's popup.js behavior.
                setChecked(!next)
                console.error(`Failed to toggle ${platform}:`, response.message)
            }
        })
    }

    return { checked, pending, toggle }
}
