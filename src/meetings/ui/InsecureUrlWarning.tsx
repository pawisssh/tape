import { Button } from "@/components/ui/button"
import { WarningIcon } from "./icons"

interface InsecureUrlWarningProps {
    onAcknowledge: () => void
}

// Shown inline below a URL field (webhook or LLM provider base URL) when
// isInsecureUrl() (src/lib/permissions.ts) flags it — a plain http:// endpoint that isn't
// localhost/a private-network address. Doesn't block the field, just gates the actual
// Connect action behind an explicit click here — see PLAN.md §7.2. Shared between
// WebhookSection.tsx and ProviderPanel.tsx rather than duplicated, since both need
// identical behavior for the identical underlying risk (transcript / transcript+API-key
// sent unencrypted).
export default function InsecureUrlWarning({ onAcknowledge }: InsecureUrlWarningProps) {
    return (
        <div className="flex items-start gap-2 border border-meetings-border bg-meetings-chip p-3 text-sm text-meetings-ink">
            <WarningIcon className="mt-0.5 size-4 shrink-0" />
            <div className="flex flex-1 flex-col gap-2">
                <p>This endpoint isn't encrypted — data sent to it can be intercepted.</p>
                <Button type="button" size="sm" variant="outline" className="w-fit rounded-none" onClick={onAcknowledge}>
                    Connect anyway
                </Button>
            </div>
        </div>
    )
}
