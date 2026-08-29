// A Chrome extension has no theme setting of its own — each surface (meetings tab,
// popup, side panel, Obsidian handoff page) is a separate mini-app that should just
// follow the OS/browser's light-or-dark preference. globals.css's `@custom-variant dark`
// is class-based (`.dark *`), not media-query-based — every shadcn `dark:` utility across
// the app depends on this actually toggling the class, or it silently never activates.
export function watchSystemTheme(): () => void {
    const media = window.matchMedia("(prefers-color-scheme: dark)")

    function apply(source: MediaQueryList | MediaQueryListEvent) {
        document.documentElement.classList.toggle("dark", source.matches)
    }

    apply(media)
    media.addEventListener("change", apply)
    return () => media.removeEventListener("change", apply)
}
