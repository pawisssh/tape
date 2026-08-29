import * as React from "react"

// Runs `effect` `delayMs` after the last time any value in `deps` changed — the shared
// primitive every settings-form page's autosave (replacing what used to be an explicit
// "Save" button) sits on top of. Never fires on mount (loading a page must never
// immediately re-write the value it just read back into storage), and never fires for
// the render right after `resetKey` changes — needed by pages like Templates where
// switching the selected record swaps every field's value at once; that transition is a
// navigation, not an edit, and must not itself count as something to (re)save.
export function useDebouncedEffect(effect: () => void, deps: React.DependencyList, delayMs: number, resetKey?: unknown): void {
  const skipNextRef = React.useRef(true)
  const prevResetKeyRef = React.useRef(resetKey)

  // Reset (during render, not in an effect) whenever resetKey changes — the standard
  // React "adjusting state when a prop changes" pattern, works the same for a ref.
  if (prevResetKeyRef.current !== resetKey) {
    prevResetKeyRef.current = resetKey
    skipNextRef.current = true
  }

  React.useEffect(() => {
    if (skipNextRef.current) {
      skipNextRef.current = false
      return
    }
    const handle = setTimeout(effect, delayMs)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
