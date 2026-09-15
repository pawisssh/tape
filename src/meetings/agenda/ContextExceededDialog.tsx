import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
// Framework-free logic module, imported directly — never duplicated into src/. This is
// the exact same calculation enrichWithLlm() itself now checks the provider's context
// window against (see its own doc comment), not just cosmetic copy here — reusing it
// keeps "does this fit" and "here's what to raise it to" from ever drifting apart.
import { suggestedContextWindow } from "../../../extension/obsidian/llm.js"

interface ContextExceededDialogProps {
    open: boolean
    requiredTokens: number
    // Absent when this was caught via the fallback path — the server itself rejected the
    // request citing context length, but its error text doesn't reliably give us its exact
    // current ceiling the way the pre-flight check's own provider query does (see
    // enrichWithLlm()'s doc comment in extension/obsidian/llm.js).
    loadedContextLength?: number
    onOpenChange: (open: boolean) => void
    onRetry: () => void
}

// Shown in place of a toast when enrichWithLlm() (extension/obsidian/llm.js) reports the
// transcript needs more tokens than the model can provide — both the inline "Run" button
// (MeetingDetail.tsx) and "Summarize now" (MeetingDetailToolbar.tsx) can hit this, so this
// dialog is shared between them rather than duplicated. Unlike the plain error toast this
// replaces, it tells the user a concrete number to reload the model with (not just "needs
// more context") and offers a Retry that re-runs the same operation — the actual model
// reload happens outside the extension, in LM Studio itself.
export default function ContextExceededDialog({
    open,
    requiredTokens,
    loadedContextLength,
    onOpenChange,
    onRetry,
}: ContextExceededDialogProps) {
    const suggested = suggestedContextWindow(requiredTokens)

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Transcript too long for the loaded model</DialogTitle>
                    <DialogDescription>
                        {loadedContextLength !== undefined ? (
                            <>
                                This meeting needs about <strong>{requiredTokens.toLocaleString()}</strong> tokens of context,
                                but the model is currently loaded with only{" "}
                                <strong>{loadedContextLength.toLocaleString()}</strong>.
                            </>
                        ) : (
                            <>
                                This meeting needs about <strong>{requiredTokens.toLocaleString()}</strong> tokens of context,
                                and the server rejected the request for exceeding its context length.
                            </>
                        )}{" "}
                        In LM Studio's Developer tab, select the model and set Context Length to at least{" "}
                        <strong>{suggested.toLocaleString()}</strong>, then retry.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        onClick={() => {
                            onOpenChange(false)
                            onRetry()
                        }}
                    >
                        Retry
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
