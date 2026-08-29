// Shared by MeetingListRow.tsx and MeetingsView.tsx's detail-column header.
export function formatDuration(startIso: string, endIso: string) {
    const duration = new Date(endIso).getTime() - new Date(startIso).getTime()
    const durationMinutes = Math.round(duration / (1000 * 60))
    const durationHours = Math.floor(durationMinutes / 60)
    const remainingMinutes = durationMinutes % 60
    return durationHours > 0 ? `${durationHours}hr ${remainingMinutes}m` : `${durationMinutes}m`
}
