// @ts-check
/// <reference path="../../types/index.js" />
/// <reference path="../../types/obsidian.js" />

// On-demand LLM summarization for one meeting, independent of the Obsidian handoff —
// this is what "Summarize now" (src/meetings/agenda/MeetingDetailToolbar.tsx) calls,
// primarily useful when `obsidianLlmAutoRun` is off (so the handoff page skips
// summarizing automatically) but also works any time a meeting doesn't have a cached
// summary yet.
//
// This used to live in extension/background-script/meetings.js and run via a
// chrome.runtime.sendMessage round trip to the background service worker. It was moved
// here — a framework-free module imported directly by the page, same as
// runSaveToObsidianFlow() in save-flow.js — because Chrome forcibly terminates any
// single in-flight network request from an extension's background service worker after
// 5 minutes (https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle),
// regardless of the AbortController timeout enrichWithLlm() is given. A long
// summarization request would get silently disconnected at that 5-minute mark no matter
// how high the user set obsidianLlmTimeoutMs in Settings. A regular extension page (like
// the Meetings page this is called from) has no such ceiling, so calling it directly —
// exactly like Run already does — removes the limit entirely instead of working around it.

import { getObsidianSettings, updateMeetingById, getMeetingById } from "./store.js"
import { enrichWithLlm } from "./llm.js"

/**
 * @param {Awaited<ReturnType<typeof enrichWithLlm>>} result
 * @returns {result is { stopped: true }}
 */
function isStopped(result) {
    return result !== null && typeof result === "object" && "stopped" in result
}

/**
 * Caches the result the same way markSummaryCache() does in src/obsidian-handoff/App.tsx.
 * Never throws — enrichWithLlm() is documented to never throw, and every other failure
 * mode here (missing meeting, LLM disabled) resolves to `{success: false, message}` instead.
 * @param {string} meetingId
 * @param {AbortSignal} [signal] lets a caller (e.g. a Stop button) cancel the in-flight LLM request — see enrichWithLlm()'s own `signal` param
 * @returns {Promise<{success: boolean, message?: string, contextExceeded?: {requiredTokens: number, loadedContextLength?: number}, stopped?: boolean}>}
 */
export function summarizeNow(meetingId, signal) {
    return Promise.all([getMeetingById(meetingId), getObsidianSettings()]).then(([meeting, settings]) => {
        if (!meeting) {
            return { success: false, message: "Meeting not found." }
        }
        if (!settings.obsidianUseLlm) {
            return { success: false, message: "Local LLM summary enrichment is off — enable it on the Integrations page first." }
        }

        return enrichWithLlm(meeting, settings, signal).then((result) => {
            if (isStopped(result)) {
                return { success: false, stopped: true, message: "Stopped." }
            }
            if (!result) {
                return { success: false, message: "Local LLM unavailable or returned nothing usable." }
            }
            if ("contextExceeded" in result) {
                const { requiredTokens, loadedContextLength } = result
                return {
                    success: false,
                    contextExceeded: { requiredTokens, loadedContextLength },
                    message:
                        loadedContextLength !== undefined
                            ? `This meeting needs about ${requiredTokens.toLocaleString()} tokens of context, ` +
                              `but the model is loaded with only ${loadedContextLength.toLocaleString()}. ` +
                              `Load it with more context in LM Studio and try again.`
                            : `This meeting needs about ${requiredTokens.toLocaleString()} tokens of context, and the ` +
                              `server rejected the request for exceeding its context length. Increase the model's ` +
                              `context length in your provider and try again.`,
                }
            }

            return updateMeetingById(meetingId, () => ({
                llmSummaryMarkdown: result.summaryMarkdown,
                llmSummaryIncludesTranscript: result.includesTranscript,
                llmSummaryIncludesChatMessages: result.includesChatMessages,
                ...(result.title ? { llmSummaryTitle: result.title } : {}),
            })).then(() => ({ success: true }))
        })
    })
}
