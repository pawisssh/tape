// @ts-check
import { cleanText, isRecord } from "./shared.js"

export const rewindSkill = {
    id: "rewind",
    /** @param {Meeting} meeting */
    buildPrompt(meeting) {
        return JSON.stringify({
            task: "Recall what was just said in a short faithful snippet. Keep exact names, numbers, and terms. Do not infer missing context.",
            outputShape: { snippet: "non-empty string" },
            transcript: meeting.transcript.map(block => ({
                speaker: block.personName, timestamp: block.timestamp, text: block.transcriptText,
            })),
        })
    },
    /** @param {unknown} value */
    validate(value) {
        if (!isRecord(value) || !cleanText(value.snippet)) return null
        return { snippet: cleanText(value.snippet) }
    },
    /** @param {{snippet: string}} value */
    render(value) {
        return value.snippet
    },
}
