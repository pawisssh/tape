import { useEffect, useRef, useState } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

interface OperationModeToggleProps {
    value: OperationMode
    onChange: (mode: OperationMode) => void
    className?: string
}

const ZONES: { mode: OperationMode; label: string }[] = [
    { mode: "off", label: "Off" },
    { mode: "manual", label: "Manual" },
    { mode: "auto", label: "Auto" },
]

// Knob left-edge position (px) for each mode — the knob is a 16px circle inside a 64px
// track, so these are: 4px inset from the left edge (off), dead center (manual, (64-16)/2),
// 4px inset from the right edge (auto, 64-16-4). Matches Figma node 2029:11 exactly. Also
// doubles as the drag range (off's 4 / auto's 44 are the min/max the knob can be dragged
// to) and the snap targets dragging resolves to — see handlePointerUp below.
const KNOB_LEFT: Record<OperationMode, number> = { off: 4, manual: 24, auto: 44 }
const KNOB_SIZE = 16 // px — matches the `size-4` class on the knob div below.

function clamp(n: number, min: number, max: number): number {
    return Math.min(Math.max(n, min), max)
}

// Whichever mode's resting position is closest to `left` — how a drag resolves to a value
// on release, same idea as a real toggle/slider snapping to its nearest detent.
function nearestMode(left: number): OperationMode {
    return ZONES.map((z) => z.mode).reduce((best, mode) =>
        Math.abs(KNOB_LEFT[mode] - left) < Math.abs(KNOB_LEFT[best] - left) ? mode : best,
    )
}

// Compact 3-position capture-mode control — Figma node 2029:11 ("pawisssh - tape" file).
// Replaces a plain on/off Switch that used to sit here (see App.tsx's own comment on why):
// that could only ever write "auto" or "off", so "manual" was unreachable from this control
// and rendered visually identical to "auto". This is a from-scratch component rather than
// a Switch variant since @base-ui/react/switch (src/components/ui/switch.tsx) is inherently
// boolean — no third state to extend.
//
// Two ways to change the value, layered independently rather than one replacing the other:
// - **Tap a zone**: the track is split into 3 real <button>s (left=off, middle=manual,
//   right=auto) under role="radiogroup"/"radio", matching the semantics (not the visual
//   style) of the RadioGroup already used for this same value in SettingsView.tsx/
//   popup/App.tsx — a click always does the same thing regardless of the control's current
//   state, and each zone is independently focusable/labeled.
// - **Drag the knob**: pointer events + setPointerCapture directly on the knob (not the
//   track or the zone buttons — dragging is a separate capability layered on top, so it
//   can't conflict with the buttons' own onClick, e.g. a drag that ends over a different
//   zone than it started incorrectly re-firing the *starting* zone's click). Follows the
//   pointer live during the drag (no CSS transition, or it'd visibly lag), then snaps —
//   this time animated — to whichever of the 3 stops is nearest on release and commits
//   that as the new value. A tap on the knob with no real movement is a safe no-op (the
//   nearest stop is just wherever it already was).
//
// Colors are the exact hex values from the Figma export, not this codebase's semantic
// tokens — "auto"'s orange happens to exactly match --color-meetings-accent (itself already
// a raw hex, not a theme-flipped token) but the greys (#B0B0B0 track, #E5E5E5 knob) don't
// correspond to any existing named token, so they're used as literal Tailwind arbitrary
// values here rather than inventing a new token for a single one-off control.
export default function OperationModeToggle({ value, onChange, className }: OperationModeToggleProps) {
    const trackRef = useRef<HTMLDivElement>(null)
    const [isDragging, setIsDragging] = useState(false)
    // Overrides the knob's position while set; null defers to KNOB_LEFT[value]. Cleared
    // whenever `value` actually changes — including right after a drag commits it, so this
    // never holds stale state once the real value has caught up.
    const [dragLeft, setDragLeft] = useState<number | null>(null)

    useEffect(() => {
        setDragLeft(null)
    }, [value])

    function leftFromPointer(clientX: number): number {
        const rect = trackRef.current?.getBoundingClientRect()
        if (!rect) return KNOB_LEFT[value]
        return clamp(clientX - rect.left - KNOB_SIZE / 2, KNOB_LEFT.off, KNOB_LEFT.auto)
    }

    function handleKnobPointerDown(e: React.PointerEvent<HTMLDivElement>) {
        e.preventDefault() // avoid text-selection while dragging with a mouse
        e.currentTarget.setPointerCapture(e.pointerId)
        setIsDragging(true)
        setDragLeft(KNOB_LEFT[value])
    }

    function handleKnobPointerMove(e: React.PointerEvent<HTMLDivElement>) {
        if (!isDragging) return
        setDragLeft(leftFromPointer(e.clientX))
    }

    function handleKnobPointerUp(e: React.PointerEvent<HTMLDivElement>) {
        if (!isDragging) return
        const mode = nearestMode(leftFromPointer(e.clientX))
        setIsDragging(false)
        setDragLeft(KNOB_LEFT[mode]) // snap — transition is back on now that isDragging is false
        if (mode !== value) onChange(mode)
    }

    return (
        <div
            ref={trackRef}
            role="radiogroup"
            aria-label="Capture mode"
            className={cn(
                "relative h-6 w-16 shrink-0 rounded-full transition-colors",
                value === "auto" ? "bg-meetings-accent" : "bg-[#B0B0B0]",
                className,
            )}
        >
            {value === "manual" && <div className="absolute inset-y-0 left-0 w-[44px] rounded-full bg-white" aria-hidden />}

            {/* Figma node 2029:12: a 1px inset border, black at 8% opacity, in every state
                (the SVG spec is `stroke="black" stroke-opacity="0.08"` on an inset rect
                matching the track's own rounding). Its own absolutely-positioned overlay
                — same undisturbed inset-0 box the knob/white-overlay are positioned
                against — rather than a real `border` on the track div itself: border-box
                sizing would shrink the *content* box those `left` offsets are measured
                from by the border width, shifting the knob visibly off-center by a pixel. */}
            <div className="pointer-events-none absolute inset-0 rounded-full border border-black/8" aria-hidden />

            {/* Figma node 2029:11's latest revision: a small black-at-4%-opacity dot at
                each stop the knob *isn't* currently resting on — a guide marking where
                dragging (added above) can snap to. The Figma source itself is inconsistent
                about which states show which guides (off shows both, manual shows one,
                auto shows none) — treated as unfinished there rather than a spec to match
                literally; showing both non-active stops in every state is the complete,
                consistent version of the same idea. Centered on the same KNOB_LEFT
                positions as the real knob (`+ 4`: the guide is 8px vs. the knob's 16px, so
                half the size difference recenters it on the same point). */}
            {ZONES.filter((zone) => zone.mode !== value).map((zone) => (
                <div
                    key={zone.mode}
                    className="pointer-events-none absolute top-2 size-2 rounded-full bg-black/4"
                    style={{ left: KNOB_LEFT[zone.mode] + 4 }}
                    aria-hidden
                />
            ))}

            <div className="relative flex h-full w-full">
                {ZONES.map((zone) => (
                    <Tooltip key={zone.mode}>
                        <TooltipTrigger
                            render={
                                <button
                                    type="button"
                                    role="radio"
                                    aria-checked={value === zone.mode}
                                    aria-label={zone.label}
                                    onClick={() => onChange(zone.mode)}
                                    className="h-full w-1/3 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                                />
                            }
                        />
                        <TooltipContent>{zone.label}</TooltipContent>
                    </Tooltip>
                ))}
            </div>

            {/* Rendered last (on top of the zone buttons above) so it's the one that
                actually receives the pointer over its own small area — the buttons still
                handle clicks everywhere else on the track. */}
            <div
                onPointerDown={handleKnobPointerDown}
                onPointerMove={handleKnobPointerMove}
                onPointerUp={handleKnobPointerUp}
                onPointerCancel={handleKnobPointerUp}
                className={cn(
                    "absolute top-1 size-4 cursor-grab touch-none rounded-full bg-[#E5E5E5] active:cursor-grabbing",
                    !isDragging && "transition-[left] duration-150 ease-out",
                )}
                style={{ left: dragLeft ?? KNOB_LEFT[value] }}
                aria-hidden
            />
        </div>
    )
}
