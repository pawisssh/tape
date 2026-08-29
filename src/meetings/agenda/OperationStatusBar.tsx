import { StopFillIcon } from "../ui/icons"

interface OperationStatusBarProps {
    label: string
    onDismiss: () => void
}

// Sticky bottom bar shown while a summarize-regenerate or Run (save-to-Obsidian)
// operation is in flight for the currently-selected meeting — see MeetingsView.tsx's
// lifted `operation` state, which both MeetingDetailToolbar.tsx (template picker /
// "Summarize now") and MeetingDetail.tsx (Run) drive. `position: sticky` pins this to the
// bottom of MasterDetailLayout's scrolling `detail` column rather than the page/viewport,
// since that's the nearest scrolling ancestor and there's no intermediate overflow
// container between here and there (see DetailTabs.tsx, the only renderer of this).
//
// Per Figma node 2005:719, the accent stripe is an indeterminate loading indicator, not a
// percentage fill — neither operation this bar serves has a real, meaningful "% complete"
// to report (a single-phase LLM call for regenerate; Run's steps are real but each one's
// duration is unknown), so a fixed-width comet-shaped gradient loops left-to-right for as
// long as the bar is mounted (see the `meetings-operation-sweep` keyframes in
// globals.css), same as any other spinner — it communicates "still working", not "N%
// done".
//
// `onDismiss` is best-effort only — it just hides the bar (clears `operation`). There is
// no cancellation primitive anywhere in this codebase's messaging/LLM layers to actually
// abort the in-flight sendMessage/runSaveToObsidianFlow call, so the underlying work keeps
// running silently. Two things keep that safe: `operation` being keyed by meeting id (see
// MeetingsView.tsx) means a stale resolution for a meeting the user has since navigated
// away from can't clobber a different meeting's bar; and MeetingDetail.tsx /
// MeetingDetailToolbar.tsx both guard their `onOperationChange` calls behind an
// isMountedRef so a resolution landing after the *specific meeting instance* that started
// it has unmounted (e.g. the user picked a different meeting mid-flight) is dropped
// instead of racing a newer operation. `operation` itself is chrome.storage.local-backed
// (not plain useState), so it also survives switching to another sidebar page and back —
// deliberately, so a genuinely-still-running operation keeps showing on return instead of
// the UI silently forgetting about it.
export default function OperationStatusBar({ label, onDismiss }: OperationStatusBarProps) {
    return (
        <div className="sticky bottom-0 flex h-9 w-full shrink-0 items-center justify-between overflow-hidden border-t border-meetings-border bg-meetings-card pr-2 pl-4">
            <div
                className="pointer-events-none absolute inset-y-0 left-0 w-1/2"
                style={{
                    // Figma's own gradient-fill inspector for this node: 0% white (opaque —
                    // over this bar's white background that's indistinguishable from
                    // transparent, so `transparent` reproduces it exactly), 50% solid
                    // #f34f16 (the peak, no plateau), 100% transparent — a single
                    // continuous triangular ramp, not a fade-in-then-hold-then-fade-out.
                    background: "linear-gradient(90deg, transparent 0%, var(--color-meetings-accent) 50%, transparent 100%)",
                    animation: "meetings-operation-sweep 1.4s ease-in-out infinite",
                }}
                aria-hidden
            />
            <span className="font-meetings-mono relative shrink-0 text-[10px] font-medium tracking-wide text-meetings-ink uppercase">
                {label}
            </span>
            <button
                type="button"
                aria-label="Dismiss"
                onClick={onDismiss}
                className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-meetings-card text-meetings-ink shadow-[0px_16px_16px_rgba(12,12,13,0.1),0px_4px_2px_rgba(12,12,13,0.05)] transition-opacity hover:opacity-70"
            >
                <StopFillIcon className="size-4" />
            </button>
        </div>
    )
}
