// Google Meet's exported transcript .txt files repeat a per-turn header line of the form
// "<Speaker Name> (MM/DD/YYYY, H:MM AM/PM)" followed by that turn's spoken text. The name
// group excludes newlines so a match can never span across a line break — since real headers
// always start their own line, that's what keeps the lazy name-capture from swallowing the
// tail of the previous turn's message.
const HEADER_RE = /([^\n(]{1,60}?)\s*\((\d{1,2})\/(\d{1,2})\/(\d{4}),\s*(\d{1,2}):(\d{2})\s*([AP]M)\)/g

// TranscripTonic-style exports append a dashes-delimited "CHAT MESSAGES" section and a
// "Transcript saved using..." credit block after the real transcript. Neither has headers of
// its own, so without this cut it silently gets glued onto the last turn's transcriptText.
const FOOTER_RE = /\n-{3,}\s*\n/

/**
 * Parses a Google Meet exported transcript into per-turn blocks with real ISO timestamps.
 * Returns [] if the text doesn't contain any recognizable header lines, so callers can fall
 * back to treating the whole file as one opaque block.
 */
export function parseGoogleMeetTranscript(fileText: string): TranscriptBlock[] {
    const footerMatch = FOOTER_RE.exec(fileText)
    const transcriptText = footerMatch ? fileText.slice(0, footerMatch.index) : fileText

    const headers: { personName: string; timestamp: string; start: number; end: number }[] = []

    for (const match of transcriptText.matchAll(HEADER_RE)) {
        const [, personName, month, day, year, hour12, minute, ampm] = match
        let hour24 = Number(hour12) % 12
        if (ampm.toUpperCase() === "PM") hour24 += 12

        const date = new Date(Number(year), Number(month) - 1, Number(day), hour24, Number(minute))
        headers.push({
            personName: personName.trim(),
            timestamp: date.toISOString(),
            start: match.index ?? 0,
            end: (match.index ?? 0) + match[0].length,
        })
    }

    if (headers.length === 0) return []

    return headers.map((header, i) => ({
        personName: header.personName,
        timestamp: header.timestamp,
        transcriptText: transcriptText.slice(header.end, headers[i + 1]?.start ?? transcriptText.length).trim(),
    }))
}
