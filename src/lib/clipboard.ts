// Shared clipboard-write helper. navigator.clipboard.writeText() throws a
// NotAllowedError/DOMException in some real situations (most notably an unfocused
// document — see src/obsidian-handoff/App.tsx, which opens its tab programmatically
// right as a Meet call ends and isn't always brought into focus immediately) — falls
// back to the legacy document.execCommand("copy") technique via a hidden textarea.
// Extracted from obsidian-handoff/App.tsx, which already needed exactly this fallback,
// so the Meetings page's own Copy-transcript action can reuse it instead of duplicating
// the logic.
export async function writeTextWithFallback(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text)
        return true
    } catch (err) {
        console.error("[clipboard] navigator.clipboard.writeText failed, trying execCommand fallback", err)
        try {
            return copyViaExecCommand(text)
        } catch (fallbackErr) {
            console.error("[clipboard] execCommand('copy') fallback threw", fallbackErr)
            return false
        }
    }
}

function copyViaExecCommand(text: string): boolean {
    const textarea = document.createElement("textarea")
    textarea.value = text
    textarea.setAttribute("readonly", "")
    textarea.style.position = "fixed"
    textarea.style.top = "0"
    textarea.style.left = "-9999px"
    textarea.style.opacity = "0"
    document.body.appendChild(textarea)
    try {
        textarea.focus()
        textarea.select()
        textarea.setSelectionRange(0, textarea.value.length)
        return document.execCommand("copy")
    } finally {
        document.body.removeChild(textarea)
    }
}
