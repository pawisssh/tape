// @ts-check
import { getObsidianSettings } from "../obsidian/store.js"
import { requestLlmJson } from "../obsidian/llm.js"
import { renderLiveRecapSource, nextLiveRecapChunkEnd, usableLiveRecapCheckpoint, RECAP_CHECKPOINT_VERSION } from "./live-recap.js"
import { LIVE_ASSIST_SYSTEM_PROMPT, LIVE_ASSIST_PROMPT_REVISION } from "./skills/shared.js"
import { rewindSkill } from "./skills/rewind.js"
import { recapSkill, emptyRecapState, mergeRecapState, RECAP_SKILL_REVISION } from "./skills/recap.js"

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
        return { success: true, message: snapshot.meeting.transcript.map(block => block.personName + ": " + block.transcriptText).join("\n") }
    } catch {
        return { success: false, message: "Could not read the live meeting." }
    }
}

/** @param {ObsidianSettings} settings @param {string} prompt */
async function requestSkill(settings, prompt) {
    const result = await requestLlmJson({
        ...settings,
        obsidianLlmTimeoutMs: Math.min(settings.obsidianLlmTimeoutMs || LIVE_AI_TIMEOUT_MS, LIVE_AI_TIMEOUT_MS),
    }, LIVE_ASSIST_SYSTEM_PROMPT, prompt)
    if (result && "contextExceeded" in result) return { error: "The transcript exceeds the selected model's context window. Increase its context size or choose another model." }
    if (!result || !("value" in result) || !result.value) return { error: "AI could not generate a valid response. Check the provider connection and try again." }
    return { value: result.value }
}

/** @param {Meeting} meeting @param {ObsidianSettings} settings @returns {Promise<ExtensionResponse>} */
async function runProgressiveRecap(meeting, settings) {
    if (recapInProgress) return { success: false, message: "A recap is already running. Please wait for it to finish." }
    recapInProgress = true
    try {
        const source = renderLiveRecapSource(meeting.transcript)
        // Language is part of the key so switching it mid-meeting restarts the recap instead
        // of merging state written in two languages.
        const connectionKey = settings.obsidianLlmEndpoint + "\n" + settings.obsidianLlmModel + "\n" + settings.outputLanguage
        const stored = await chrome.storage.local.get("liveRecapCheckpoint")
        const checkpoint = usableLiveRecapCheckpoint(stored.liveRecapCheckpoint, meeting.meetingStartTimestamp, connectionKey, source)
        let processed = checkpoint?.sourceText.length || 0
        let state = checkpoint?.state || emptyRecapState()
        const started = Date.now()
        let chunksProcessed = 0
        while (processed < source.length) {
            if (chunksProcessed > 0 && Date.now() - started > RECAP_REQUEST_BUDGET_MS - 60000) break
            let end = nextLiveRecapChunkEnd(source, processed)
            let answer
            while (true) {
                answer = await requestSkill(settings, recapSkill.buildPrompt(state, source.slice(processed, end), settings.outputLanguage))
                if (!("error" in answer) || !answer.error.startsWith("The transcript exceeds") || end - processed <= 1200) break
                end = processed + Math.floor((end - processed) / 2)
            }
            const output = "value" in answer ? recapSkill.validate(answer.value) : null
            if (!output) {
                const error = "error" in answer ? answer.error : "AI returned an invalid recap. Try again."
                if (!processed) return { success: false, message: error }
                return { success: true, message: recapSkill.render(state, settings.outputLanguage), model: settings.obsidianLlmModel, partial: true,
                    progress: "Recap paused at " + Math.round(processed / source.length * 100) + "%. Press Recap again to continue. " + error }
            }
            state = mergeRecapState(state, output, source.slice(processed, end))
            processed = end
            chunksProcessed++
            await chrome.storage.local.set({ liveRecapCheckpoint: {
                schemaVersion: RECAP_CHECKPOINT_VERSION,
                promptRevision: LIVE_ASSIST_PROMPT_REVISION,
                skillRevision: RECAP_SKILL_REVISION,
                meetingStartTimestamp: meeting.meetingStartTimestamp,
                connectionKey,
                sourceText: source.slice(0, processed),
                state,
            } })
        }
        return { success: true, message: recapSkill.render(state, settings.outputLanguage), model: settings.obsidianLlmModel,
            ...(processed < source.length
                ? { partial: true, progress: "Recap is " + Math.round(processed / source.length * 100) + "% caught up. Press Recap again to continue." }
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
        const answer = await requestSkill(settings, rewindSkill.buildPrompt(meeting, settings.outputLanguage))
        if ("error" in answer) return { success: false, message: answer.error }
        const output = rewindSkill.validate(answer.value)
        if (!output) return { success: false, message: "AI returned an invalid rewind. Try again." }
        return { success: true, message: rewindSkill.render(output), model: settings.obsidianLlmModel, capturedAt: meeting.meetingEndTimestamp }
    } catch {
        return { success: false, message: "Could not read the live meeting or reach AI. Check that capture is running and try again." }
    }
}
