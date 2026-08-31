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
// `onDismiss` both hides the bar (clears `operation`) AND actually cancels the in-flight
// LLM request — MeetingDetail.tsx's `onDismissStatus` calls MeetingsView.tsx's
// `cancelOperation(meetingId)` first, which aborts whichever AbortController
// MeetingDetail.tsx/MeetingDetailToolbar.tsx registered for this meeting (see
// MeetingsView.tsx's cancelHandlersRef), which extension/obsidian/llm.js bridges into the
// actual `fetch()` — LM Studio detects the dropped connection and stops generating
// server-side too, not just client-side. This is real cancellation only for the `llm` step
// specifically; Run's other steps (markdown/deliver/launch) are fast, local operations
// with nothing to cancel, so clicking Stop during one of those is still just a bar-dismiss.
// Two things keep the underlying-work-keeps-running case (a stale/already-unregistered
// cancel handler, or a click during a non-cancelable step) safe: `operation` being keyed
// by meeting id (see MeetingsView.tsx) means a stale resolution for a meeting the user has
// since navigated away from can't clobber a different meeting's bar; and MeetingDetail.tsx
// / MeetingDetailToolbar.tsx both guard their `onOperationChange` calls behind an
// isMountedRef so a resolution landing after the *specific meeting instance* that started
// it has unmounted (e.g. the user picked a different meeting mid-flight) is dropped
// instead of racing a newer operation. `operation` itself is chrome.storage.local-backed
// (not plain useState), so it also survives switching to another sidebar page and back —
// deliberately, so a genuinely-still-running operation keeps showing on return instead of
// the UI silently forgetting about it.
export default function OperationStatusBar({ label, onDismiss }: OperationStatusBarProps) {
    return (
        // Figma node 2005:667 ("Toolbar", the parent frame of the 2005:719 gradient cited
        // above): the bar's own background is a flat black-at-12%-opacity overlay
        // (`rgba(0,0,0,0.12)`), not this design's usual solid `meetings-card` — a
        // deliberate one-off, not a token gap.
        <div className="sticky bottom-0 flex h-9 w-full shrink-0 items-center justify-between overflow-hidden border-t border-meetings-border bg-black/12 pr-2 pl-4">
            <div
                className="pointer-events-none absolute inset-y-0 left-0 w-1/2"
                style={{
                    // Figma node 2005:719 gradient specification:
                    background: "linear-gradient(90deg, rgba(255, 255, 255, 0.00) 0%, #F34F16 50%, rgba(255, 255, 255, 0.00) 100%)",
                    animation: "meetings-operation-sweep 1.4s ease-in-out infinite",
                }}
                aria-hidden
            />
            <span className="font-meetings-mono relative shrink-0 text-[10px] font-medium tracking-wide text-meetings-ink uppercase">
                {label}
            </span>
            <button
                type="button"
                aria-label="Stop"
                onClick={onDismiss}
                className="relative flex size-9 shrink-0 items-center justify-center text-meetings-ink transition-opacity hover:opacity-70"
            >
                <StopFillIcon className="size-4" />
            </button>
        </div>
    )
}
