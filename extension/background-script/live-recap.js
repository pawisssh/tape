// @ts-check

// Keep each model request well below common local-model context sizes. The saved
// checkpoint advances only after a successful summary, so a retry resumes safely.
export const RECAP_CHUNK_CHARS = 6000

/** @param {TranscriptBlock[]} transcript */
export function renderLiveRecapSource(transcript) {
    return transcript.map(block => `${block.personName} (${block.timestamp}): ${block.transcriptText}`).join("\n\n")
}

/** @param {string} source @param {number} offset */
export function nextLiveRecapChunkEnd(source, offset) {
    const limit = Math.min(source.length, offset + RECAP_CHUNK_CHARS)
    if (limit === source.length) return limit
    const breakAt = Math.max(source.lastIndexOf("\n\n", limit), source.lastIndexOf(" ", limit))
    return breakAt > offset + RECAP_CHUNK_CHARS / 2 ? breakAt + (source.slice(breakAt, breakAt + 2) === "\n\n" ? 2 : 1) : limit
}

/** @param {unknown} checkpoint @param {string} meetingStartTimestamp @param {string} connectionKey @param {string} source */
export function usableLiveRecapCheckpoint(checkpoint, meetingStartTimestamp, connectionKey, source) {
    if (!checkpoint || typeof checkpoint !== "object") return null
    const saved = /** @type {{meetingStartTimestamp?: string, connectionKey?: string, sourceText?: string, summary?: string}} */ (checkpoint)
    return saved.meetingStartTimestamp === meetingStartTimestamp && saved.connectionKey === connectionKey &&
        typeof saved.sourceText === "string" && source.startsWith(saved.sourceText) && typeof saved.summary === "string"
        ? saved : null
}
