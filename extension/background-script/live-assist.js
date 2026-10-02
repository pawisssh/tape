// @ts-check
import { getObsidianSettings } from "../obsidian/store.js"
import { enrichWithLlm } from "../obsidian/llm.js"
import { INTERPRETER_SYSTEM_PROMPT } from "../obsidian/interpreter.js"
import { renderLiveRecapSource, nextLiveRecapChunkEnd, usableLiveRecapCheckpoint } from "./live-recap.js"

const LIVE_AI_TIMEOUT_MS = 45000
const RECAP_REQUEST_BUDGET_MS = 165000
/** @type {boolean} */
let recapInProgress = false

/** @param {"rewind" | "recap"} mode @param {number} [sourceTabId] */
async function readLiveSnapshot(mode, sourceTabId) {
    const { meetingTabId } = await chrome.storage.local.get("meetingTabId")
    if (typeof meetingTabId !== "number") return { error: "Start capturing a meeting first." }
    if (sourceTabId !== undefined && sourceTabId !== meetingTabId) return { error: "Capture is running in a different meeting tab." }
    const meeting = /** @type {Meeting} */ (await chrome.tabs.sendMessage(meetingTabId, { type: "get_live_snapshot", mode }))
    if (!meeting?.transcript?.length) return { error: mode === "rewind" ? "No captions received in the last 15 seconds." : "No transcript captured yet." }
    return { meeting }
}

/** @param {"rewind" | "recap"} mode @param {number} [sourceTabId] @returns {Promise<ExtensionResponse>} */
export async function getLiveAssistPreview(mode, sourceTabId) {
    try {
        if (mode !== "rewind") return { success: false, message: "Unknown live action." }
        const snapshot = await readLiveSnapshot(mode, sourceTabId)
        if ("error" in snapshot) return { success: false, message: snapshot.error }
        return { success: true, message: snapshot.meeting.transcript.map(block => `${block.personName}: ${block.transcriptText}`).join("\n") }
    } catch {
        return { success: false, message: "Could not read the live meeting." }
    }
}

/** @param {Meeting} meeting @param {ObsidianSettings} settings @param {string} instruction */
async function summarizeExcerpt(meeting, settings, instruction) {
    /** @type {SummaryTemplate} */
    const template = { id: "live-assist", name: "Live assist", keywords: "", properties: [], noteContent: `{{"${instruction}"}}` }
    const result = await enrichWithLlm({ ...meeting, templateOverrideId: template.id }, {
        ...settings,
        obsidianUseLlm: true,
        obsidianLlmSummaryTemplates: [template],
        obsidianLlmSystemPrompt: INTERPRETER_SYSTEM_PROMPT,
        obsidianLlmTimeoutMs: Math.min(settings.obsidianLlmTimeoutMs || LIVE_AI_TIMEOUT_MS, LIVE_AI_TIMEOUT_MS),
    })
    if (result && "contextExceeded" in result) return { error: "The transcript exceeds the selected model's context window. Increase its context size or choose another model." }
    if (!result || !("summaryMarkdown" in result) || !result.summaryMarkdown.trim()) return { error: "AI could not generate a response. Check the provider connection and try again." }
    return { text: result.summaryMarkdown }
}

/** @param {Meeting} meeting @param {ObsidianSettings} settings @returns {Promise<ExtensionResponse>} */
async function runProgressiveRecap(meeting, settings) {
    if (recapInProgress) return { success: false, message: "A recap is already running. Please wait for it to finish." }
    recapInProgress = true
    try {
        const source = renderLiveRecapSource(meeting.transcript)
        const connectionKey = `${settings.obsidianLlmEndpoint}\n${settings.obsidianLlmModel}`
        const stored = await chrome.storage.local.get("liveRecapCheckpoint")
        const checkpoint = usableLiveRecapCheckpoint(stored.liveRecapCheckpoint, meeting.meetingStartTimestamp, connectionKey, source)
        let processed = checkpoint?.sourceText.length || 0
        let summary = checkpoint?.summary || ""
        const started = Date.now()
        let chunksProcessed = 0
        while (processed < source.length) {
            if (chunksProcessed > 0 && Date.now() - started > RECAP_REQUEST_BUDGET_MS - 60000) break
            let end = nextLiveRecapChunkEnd(source, processed)
            let answer
            while (true) {
                const excerpt = source.slice(processed, end)
                const transcript = [
                    ...(summary ? [{ personName: "Previous recap", timestamp: meeting.meetingStartTimestamp, transcriptText: summary }] : []),
                    { personName: "New transcript", timestamp: meeting.meetingEndTimestamp, transcriptText: excerpt },
                ]
                answer = await summarizeExcerpt({ ...meeting, transcript }, settings,
                    "Update the previous recap using the new transcript excerpt. Write a concise high-level recap of the meeting so far, including only supported topics, decisions, action items and unresolved questions. Keep it under 1200 characters. Preserve the conversation language. Do not invent details or imply the meeting has ended.")
                if (!("error" in answer) || !answer.error.startsWith("The transcript exceeds") || end - processed <= 1200) break
                end = processed + Math.floor((end - processed) / 2)
            }
            if ("error" in answer) {
                if (!summary) return { success: false, message: answer.error }
                return { success: true, message: summary, model: settings.obsidianLlmModel, partial: true,
                    progress: `Recap paused at ${Math.round(processed / source.length * 100)}%. Press Recap again to continue. ${answer.error}` }
            }
            summary = answer.text
            processed = end
            chunksProcessed++
            await chrome.storage.local.set({ liveRecapCheckpoint: {
                meetingStartTimestamp: meeting.meetingStartTimestamp,
                connectionKey,
                sourceText: source.slice(0, processed),
                summary,
            } })
        }
        return { success: true, message: summary, model: settings.obsidianLlmModel,
            ...(processed < source.length
                ? { partial: true, progress: `Recap is ${Math.round(processed / source.length * 100)}% caught up. Press Recap again to continue.` }
                : { capturedAt: meeting.meetingEndTimestamp }) }
    } finally {
        recapInProgress = false
    }
}

/** @param {"rewind" | "recap"} mode @param {number} [sourceTabId] @returns {Promise<ExtensionResponse>} */
export async function runLiveAssist(mode, sourceTabId) {
    try {
        if (mode !== "rewind" && mode !== "recap") return { success: false, message: "Unknown live action." }
        const snapshot = await readLiveSnapshot(mode, sourceTabId)
        if ("error" in snapshot) return { success: false, message: snapshot.error }
        const meeting = snapshot.meeting
        const settings = await getObsidianSettings()
        if (!settings.obsidianLlmEndpoint || !settings.obsidianLlmModel) return { success: false, message: "Select an AI provider and model in Integrations first." }
        if (mode === "recap") return await runProgressiveRecap(meeting, settings)
        const answer = await summarizeExcerpt(meeting, settings,
            "Recall what was just said in this excerpt in a short faithful text snippet. Preserve names, numbers and technical terms. Use the language of the conversation. Do not invent missing context or instructions.")
        if ("error" in answer) return { success: false, message: answer.error }
        return { success: true, message: answer.text, model: settings.obsidianLlmModel, capturedAt: meeting.meetingEndTimestamp }
    } catch {
        return { success: false, message: "Could not read the live meeting or reach AI. Check that capture is running and try again." }
    }
}
