import { cn } from "@/lib/utils"

// Shared list+detail shape used by every page (Meetings, Integrations, Templates,
// Settings) — a content/list column capped at 400px and a detail column capped at 720px
// (plus the 320px primary sidebar = 1440px total), matching the Figma layout-scaffold
// spec (file "-v3--Components---Core", node 249:11: Sidebar 320 / Content View 400 /
// Inspector View 720). On `md+`, each column is its own independent pane — a
// `contentTitle`/`detailTitle` header that never scrolls, with only that column's body
// scrolling underneath it (matching x.com: the "Settings" heading and the
// selected-category heading each stay fixed while only their own column's list/detail
// content scrolls), and both columns render side by side regardless of `mobileDetailOpen`.
// Below `md`, only one column renders at a time (see `mobileDetailOpen` below) — matching
// x.com's own behavior of dropping its middle list pane below a certain width in favor of
// a single full-bleed detail pane with a back button.
//
// Both title rows are a fixed 64px (`h-16`), matching the primary Sidebar's own 64px
// header exactly (see App.tsx's SidebarHeader) — the Figma layout scaffold shows all
// three columns' headers at the same height, so `contentTitle`/`detailTitle` are expected
// to be bare heading content only (no description, no own padding/height styling — this
// wrapper owns all of that now) and stay visually aligned across pages regardless of what
// each page puts in them, including when `detailTitle` is null (nothing selected yet). No
// divider under the header — the column's own `md:border-r` (see below) is the only
// dividing line. Per-page description text that used to live in the header now lives at
// the top of that column's scrollable body instead — see each view.
//
// Deliberately no horizontal padding on the column wrappers themselves — measured against
// the real x.com/settings/account DOM, list rows there are full-bleed (their own box runs
// edge-to-edge to the divider) with the ~16px text inset coming from padding on each row/
// heading, not a container gutter. Column-level padding would double up with that and
// leave a dead gap before the divider, so non-list `detail`/`content` content is expected
// to bring its own `px-4` (matching the rows' own inset) — see each view for the concrete
// pattern. The `content` column's scrollable body gets `pb-4` so the last row in a long
// list always has a little room below it instead of running flush to the bottom edge.
// The `detail` column deliberately doesn't: it can end in a sticky bottom bar (see
// DetailTabs.tsx's OperationStatusBar) that needs to sit flush against the true bottom
// edge, not floating `pb-4` above it.
interface MasterDetailLayoutProps {
    contentTitle: React.ReactNode
    content: React.ReactNode
    detailTitle: React.ReactNode
    detail: React.ReactNode
    // Below `md`, only one of the two columns renders at a time — the list until a row is
    // picked, then the detail (with its own back button, rendered by the caller inside
    // detailTitle so it sits inline with that page's heading — the caller owns the onClick
    // that flips this back to false, since this component never sees that setter). At
    // `md`+ both columns always render side by side regardless of this, unchanged from
    // before.
    mobileDetailOpen: boolean
    // Optional extra class(es) on the root element — e.g. a per-page design-language
    // scoping class (see src/styles/globals.css's .meetings-redesign) that only some
    // callers need. Purely additive; every existing caller that omits this is unaffected.
    className?: string
}

export default function MasterDetailLayout({
    contentTitle,
    content,
    detailTitle,
    detail,
    mobileDetailOpen,
    className,
}: MasterDetailLayoutProps) {
    return (
        <div className={cn("flex h-full flex-col md:flex-row md:overflow-hidden", className)}>
            <div
                className={cn(
                    "h-full flex-col overflow-hidden md:w-[400px] md:shrink-0 md:border-r",
                    mobileDetailOpen ? "hidden md:flex" : "flex md:flex",
                )}
            >
                <div className="flex h-16 shrink-0 items-center gap-2 px-4">{contentTitle}</div>
                <div className="min-h-0 flex-1 overflow-y-auto pb-4">{content}</div>
            </div>
            <div
                className={cn(
                    "h-full min-w-0 flex-col overflow-hidden md:max-w-[720px] md:flex-1",
                    mobileDetailOpen ? "flex md:flex" : "hidden md:flex",
                )}
            >
                <div className="flex h-16 shrink-0 items-center gap-2 px-4">{detailTitle}</div>
                <div className="min-h-0 flex-1 overflow-y-auto">{detail}</div>
            </div>
        </div>
    )
}
