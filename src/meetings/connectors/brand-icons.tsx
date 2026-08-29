// Official brand marks for the Integrations page's connector/platform cards, sourced
// from extension/icons/ (see that folder for the original files/attribution). All four
// render the same way — a bare <img> at whatever size the caller passes — so they read
// consistently as a row of marks rather than some floating and others boxed in a tile.
import googleMeetIcon from "../../../extension/icons/google-meet.svg"
import teamsIcon from "../../../extension/icons/teams.svg"
import zoomIcon from "../../../extension/icons/zoom.svg"
import obsidianIcon from "../../../extension/icons/obsidian.svg"

interface BrandIconProps {
    className?: string
}

export function GoogleMeetIcon({ className }: BrandIconProps) {
    return <img src={googleMeetIcon} alt="" className={className} />
}

export function TeamsIcon({ className }: BrandIconProps) {
    return <img src={teamsIcon} alt="" className={className} />
}

export function ZoomIcon({ className }: BrandIconProps) {
    return <img src={zoomIcon} alt="" className={className} />
}

export function ObsidianIcon({ className }: BrandIconProps) {
    return <img src={obsidianIcon} alt="" className={className} />
}
