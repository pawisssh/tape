import { isToday, isYesterday, format, startOfDay } from "date-fns"

export interface MeetingDayGroup {
    key: string
    label: string
    meetings: { meeting: Meeting; index: number }[]
}

function dayLabel(date: Date): string {
    if (isToday(date)) return "Today"
    if (isYesterday(date)) return "Yesterday"
    return format(date, "EEEE, MMMM d")
}

/**
 * Buckets meetings by the calendar day of `meetingStartTimestamp`, newest day first
 * (matches the existing "latest meeting first" ordering), each day's meetings also
 * newest first.
 */
export function groupMeetingsByDay(meetings: { meeting: Meeting; index: number }[]): MeetingDayGroup[] {
    const groups = new Map<string, MeetingDayGroup>()

    for (const entry of meetings) {
        const date = startOfDay(new Date(entry.meeting.meetingStartTimestamp))
        const key = date.toISOString()
        let group = groups.get(key)
        if (!group) {
            group = { key, label: dayLabel(date), meetings: [] }
            groups.set(key, group)
        }
        group.meetings.push(entry)
    }

    return Array.from(groups.values())
        .sort((a, b) => b.key.localeCompare(a.key))
        .map((group) => ({
            ...group,
            meetings: group.meetings.sort(
                (a, b) =>
                    new Date(b.meeting.meetingStartTimestamp).getTime() -
                    new Date(a.meeting.meetingStartTimestamp).getTime(),
            ),
        }))
}
