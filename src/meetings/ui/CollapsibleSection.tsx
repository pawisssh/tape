import { useState } from "react"
import { KeyboardArrowDownIcon, KeyboardArrowRightIcon } from "./icons"

interface CollapsibleSectionProps {
    label: string
    defaultOpen?: boolean
    children: React.ReactNode
}

// Summary tab section wrapper (Action Items/Decisions/Open questions/Next steps/
// TL;DR/Topics) — a disclosure with a body-font (Roboto), natural-case 24px heading (per
// Figma — NOT the Space Grotesk all-caps chrome treatment used elsewhere on this page)
// and a Material Symbols chevron that swaps orientation on toggle. No item-count badge —
// Figma's design doesn't show one next to these headings.
export default function CollapsibleSection({ label, defaultOpen = false, children }: CollapsibleSectionProps) {
    const [open, setOpen] = useState(defaultOpen)

    return (
        <div className="border-b border-black/12">
            <button type="button" onClick={() => setOpen((o) => !o)} className="flex h-12 w-full items-center gap-2 px-4 text-left">
                {open ? (
                    <KeyboardArrowDownIcon className="size-6 shrink-0 text-black/87" />
                ) : (
                    <KeyboardArrowRightIcon className="size-6 shrink-0 text-black/87" />
                )}
                <span className="font-meetings-body text-2xl text-black/87">{label}</span>
            </button>
            {open ? <div className="pr-4 pb-3 pl-12">{children}</div> : null}
        </div>
    )
}
