// @ts-check
import { LIVE_ASSIST_PROMPT_REVISION } from "./skills/shared.js"
import { validateRecapState, RECAP_SKILL_REVISION } from "./skills/recap.js"

// Keep each model request well below common local-model context sizes. The saved
// checkpoint advances only after a successful summary, so a retry resumes safely.
export const RECAP_CHUNK_CHARS = 6000
export const RECAP_CHECKPOINT_VERSION = 1

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
    const saved = /** @type {{schemaVersion?: number, promptRevision?: number, skillRevision?: number, meetingStartTimestamp?: string, connectionKey?: string, sourceText?: string, state?: unknown}} */ (checkpoint)
    const state = validateRecapState(saved.state)
    return saved.schemaVersion === RECAP_CHECKPOINT_VERSION &&
        saved.promptRevision === LIVE_ASSIST_PROMPT_REVISION &&
        saved.skillRevision === RECAP_SKILL_REVISION &&
        saved.meetingStartTimestamp === meetingStartTimestamp && saved.connectionKey === connectionKey &&
        typeof saved.sourceText === "string" && source.startsWith(saved.sourceText) && state
        ? { ...saved, sourceText: saved.sourceText, state } : null
}
