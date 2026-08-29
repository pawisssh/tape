import * as React from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

interface CircleIconButtonProps extends Omit<React.ComponentPropsWithoutRef<"button">, "children"> {
    label: string
    icon: React.ReactNode
    // When true, drops this button's own white background + drop shadow — for grouping
    // multiple buttons inside one shared pill container that supplies those instead (see
    // MeetingDetail.tsx's Copy+Download pill, matching Figma's grouped toolbar treatment).
    bare?: boolean
}

// The redesign's one recurring "floating action" control — a 36px circle, sharp
// everywhere else in this design language but fully round here (see
// src/styles/globals.css's .meetings-redesign scope for the fonts this sits alongside).
// Always wrapped in a Tooltip showing `label`, which also serves as the button's
// aria-label — every usage of this component is icon-only, no visible text.
const CircleIconButton = React.forwardRef<HTMLButtonElement, CircleIconButtonProps>(
    ({ label, icon, bare, className, ...props }, ref) => (
        <Tooltip>
            <TooltipTrigger
                render={
                    <button
                        ref={ref}
                        type="button"
                        aria-label={label}
                        className={cn(
                            "flex size-9 shrink-0 items-center justify-center rounded-full text-black/87 transition-opacity hover:opacity-70 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-6",
                            !bare && "bg-white shadow-[0px_16px_16px_rgba(12,12,13,0.1),0px_4px_2px_rgba(12,12,13,0.05)]",
                            className,
                        )}
                        {...props}
                    >
                        {icon}
                    </button>
                }
            />
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    ),
)
CircleIconButton.displayName = "CircleIconButton"

export default CircleIconButton
