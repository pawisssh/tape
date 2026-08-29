import * as React from "react"

// The band where the primary Sidebar should auto-collapse to its icon-only rail: below
// this it's already the off-canvas drawer (see use-mobile.ts's MOBILE_BREAKPOINT), above
// it there's room for the full labeled sidebar.
const COMPACT_MIN = 768
const COMPACT_MAX = 1024

export function useIsCompactSidebar() {
  const [isCompact, setIsCompact] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${COMPACT_MIN}px) and (max-width: ${COMPACT_MAX - 1}px)`)
    const onChange = () => {
      setIsCompact(mql.matches)
    }
    mql.addEventListener("change", onChange)
    setIsCompact(mql.matches)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isCompact
}

// Above this, the expanded sidebar gets its full 320px width; between COMPACT_MAX and
// this it's still expanded (not collapsed to the icon rail) but at a narrower 240px.
// SidebarProvider hardcodes its own inline `--sidebar-width` style, which always beats a
// CSS class targeting the same property regardless of breakpoint — so this has to be a JS
// media query driving that inline style's value, not a Tailwind responsive class.
const WIDE_MIN = 1280

export function useIsWideSidebar() {
  const [isWide, setIsWide] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${WIDE_MIN}px)`)
    const onChange = () => {
      setIsWide(mql.matches)
    }
    mql.addEventListener("change", onChange)
    setIsWide(mql.matches)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isWide
}
