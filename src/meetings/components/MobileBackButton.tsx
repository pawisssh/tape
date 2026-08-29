import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"

// Only visible below `md`, where MasterDetailLayout shows a single pane at a time (see
// MasterDetailLayout.tsx's mobileDetailOpen) — returns from the detail pane to the list.
export default function MobileBackButton({ onClick }: { onClick: () => void }) {
    return (
        <Button type="button" variant="ghost" size="icon-sm" className="-ml-2 md:hidden" onClick={onClick}>
            <ArrowLeft />
        </Button>
    )
}
