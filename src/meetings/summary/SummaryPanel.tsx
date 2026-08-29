import { cn } from "@/lib/utils"
import { parseSummaryMarkdown, isSummaryEmpty, type TimestampedItem } from "./parse-summary-markdown"
import CollapsibleSection from "../ui/CollapsibleSection"
import { CheckCircleFillIcon, CircleIcon } from "../ui/icons"

function TimestampChip({ timestamp }: { timestamp?: string }) {
    if (!timestamp) return null
    return (
        <span className="font-meetings-mono ml-1.5 shrink-0 bg-meetings-chip px-1 py-0.5 text-[10px] text-meetings-ink-faint tabular-nums">
            {timestamp}
        </span>
    )
}

function TimestampedList({ items }: { items: TimestampedItem[] }) {
    return (
        <ul className="flex flex-col gap-2">
            {items.map((item, i) => (
                <li key={i} className="flex items-start justify-between gap-2 text-sm text-meetings-ink">
                    <span>{item.text}</span>
                    <TimestampChip timestamp={item.timestamp} />
                </li>
            ))}
        </ul>
    )
}

interface SummaryPanelProps {
    markdown: string | undefined
    onToggleActionItem: (itemIndex: number) => void
}

export default function SummaryPanel({ markdown, onToggleActionItem }: SummaryPanelProps) {
    const summary = parseSummaryMarkdown(markdown)

    if (isSummaryEmpty(summary)) {
        if (markdown && markdown.trim()) {
            // A custom template's noteContent used headings/structure the fixed parser
            // above doesn't recognize (it's hand-rolled against the built-in default
            // template's exact output shape) — fall back to showing it as-is rather than
            // claiming there's no summary when there plainly is one.
            return <div className="px-4 py-4 text-sm whitespace-pre-wrap text-meetings-ink">{markdown}</div>
        }
        return <p className="px-4 py-4 text-sm text-meetings-ink-muted">No summary yet.</p>
    }

    return (
        <div className="flex flex-col">
            {summary.actionItems.length > 0 && (
                <CollapsibleSection label="Action Items" defaultOpen>
                    <ul className="flex flex-col gap-2">
                        {summary.actionItems.map((item, i) => (
                            <li key={i} className="flex items-center gap-2.5 text-sm">
                                <button type="button" onClick={() => onToggleActionItem(i)} className="shrink-0">
                                    {item.done ? (
                                        <CheckCircleFillIcon className="size-6 text-meetings-ink" />
                                    ) : (
                                        <CircleIcon className="size-6 text-meetings-ink" />
                                    )}
                                </button>
                                <span className={cn("flex-1 text-meetings-ink", item.done && "line-through")}>{item.text}</span>
                                {item.assignee ? <span className="shrink-0 text-meetings-ink">{item.assignee}</span> : null}
                                <TimestampChip timestamp={item.timestamp} />
                            </li>
                        ))}
                    </ul>
                </CollapsibleSection>
            )}

            {summary.decisions.length > 0 && (
                <CollapsibleSection label="Decision made">
                    <TimestampedList items={summary.decisions} />
                </CollapsibleSection>
            )}

            {summary.openQuestions.length > 0 && (
                <CollapsibleSection label="Open questions">
                    <TimestampedList items={summary.openQuestions} />
                </CollapsibleSection>
            )}

            {summary.nextSteps.length > 0 && (
                <CollapsibleSection label="Next steps">
                    <TimestampedList items={summary.nextSteps} />
                </CollapsibleSection>
            )}

            {summary.keyTakeaways.length > 0 && (
                <CollapsibleSection label="TL;DR">
                    <ul className="flex flex-col gap-2">
                        {summary.keyTakeaways.map((item, i) => (
                            <li key={i} className="text-sm text-meetings-ink">
                                <span className="font-bold">{item.lead}:</span> {item.detail}
                            </li>
                        ))}
                    </ul>
                </CollapsibleSection>
            )}

            {summary.topics.length > 0 && (
                <CollapsibleSection label="Topics">
                    <div className="flex flex-col gap-3">
                        {summary.topics.map((topic, i) => (
                            <div key={i}>
                                <p className="mb-1 text-sm font-bold text-meetings-ink">{topic.heading}</p>
                                <TimestampedList items={topic.points} />
                            </div>
                        ))}
                    </div>
                </CollapsibleSection>
            )}
        </div>
    )
}
