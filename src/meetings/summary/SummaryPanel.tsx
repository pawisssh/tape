import { CheckSquare, CircleDot, HelpCircle, ArrowRight, Sparkles, Layers } from "lucide-react"
import { parseSummaryMarkdown, isSummaryEmpty, type TimestampedItem } from "./parse-summary-markdown"

function TimestampChip({ timestamp }: { timestamp?: string }) {
    if (!timestamp) return null
    return (
        <span className="text-muted-foreground bg-foreground/5 ml-1.5 shrink-0 rounded px-1 py-0.5 font-mono text-[10px] tabular-nums">
            {timestamp}
        </span>
    )
}

function SectionHeading({ icon: Icon, children }: { icon: typeof CheckSquare; children: React.ReactNode }) {
    return (
        <div className="text-foreground/80 mb-2 flex items-center gap-1.5 text-xs font-bold tracking-wide uppercase">
            <Icon className="size-3.5" />
            {children}
        </div>
    )
}

function TimestampedList({ items }: { items: TimestampedItem[] }) {
    return (
        <ul className="flex flex-col gap-1.5">
            {items.map((item, i) => (
                <li key={i} className="flex items-start justify-between gap-2 text-sm">
                    <span>{item.text}</span>
                    <TimestampChip timestamp={item.timestamp} />
                </li>
            ))}
        </ul>
    )
}

export default function SummaryPanel({ markdown }: { markdown: string | undefined }) {
    const summary = parseSummaryMarkdown(markdown)

    if (isSummaryEmpty(summary)) {
        return <p className="text-muted-foreground text-sm">No summary yet.</p>
    }

    return (
        <div className="flex flex-col gap-5">
            {summary.actionItems.length > 0 && (
                <section>
                    <SectionHeading icon={CheckSquare}>Action items</SectionHeading>
                    <ul className="flex flex-col gap-1.5">
                        {summary.actionItems.map((item, i) => (
                            <li key={i} className="flex items-start justify-between gap-2 text-sm">
                                <span className="flex items-start gap-2">
                                    <span
                                        aria-hidden
                                        className="border-muted-foreground/50 mt-0.5 inline-block size-3.5 shrink-0 rounded-sm border"
                                    />
                                    {item.text}
                                </span>
                                <TimestampChip timestamp={item.timestamp} />
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {summary.decisions.length > 0 && (
                <section>
                    <SectionHeading icon={CircleDot}>Decisions made</SectionHeading>
                    <TimestampedList items={summary.decisions} />
                </section>
            )}

            {summary.openQuestions.length > 0 && (
                <section>
                    <SectionHeading icon={HelpCircle}>Open questions</SectionHeading>
                    <TimestampedList items={summary.openQuestions} />
                </section>
            )}

            {summary.nextSteps.length > 0 && (
                <section>
                    <SectionHeading icon={ArrowRight}>Next steps</SectionHeading>
                    <TimestampedList items={summary.nextSteps} />
                </section>
            )}

            {summary.keyTakeaways.length > 0 && (
                <section>
                    <SectionHeading icon={Sparkles}>Key takeaways</SectionHeading>
                    <ul className="flex flex-col gap-1.5">
                        {summary.keyTakeaways.map((item, i) => (
                            <li key={i} className="text-sm">
                                <span className="font-bold">{item.lead}:</span> {item.detail}
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {summary.topics.length > 0 && (
                <section>
                    <SectionHeading icon={Layers}>Topics</SectionHeading>
                    <div className="flex flex-col gap-3">
                        {summary.topics.map((topic, i) => (
                            <div key={i}>
                                <p className="mb-1 text-sm font-bold">{topic.heading}</p>
                                <TimestampedList items={topic.points} />
                            </div>
                        ))}
                    </div>
                </section>
            )}
        </div>
    )
}
