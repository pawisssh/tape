// @ts-check
/// <reference path="../../types/index.js" />
/// <reference path="../../types/obsidian.js" />

// The actual "Save to Obsidian" work — LLM enrich-or-reuse-cache, build the note,
// deliver it (inline URI or clipboard), then hand off to the obsidian:// URI scheme.
// Extracted out of src/obsidian-handoff/App.tsx so this logic has exactly one home,
// shared by that page (still the vehicle for the automatic post-meeting-end save) and
// the Meetings page's own inline "Run" button (src/meetings/agenda/MeetingDetail.tsx),
// which no longer opens a separate tab for a manual save. See PLAN.md §6 Phase 5
// "Structural rule to preserve" — framework-free logic modules, never duplicated.
//
// Deliberately DOM-adjacent (uses `window.location.href`, `chrome.windows.*`) unlike its
// sibling modules (llm.js/markdown.js/uri.js/store.js) — those are also imported by the
// background service worker (no DOM there), but this file is only ever imported from a
// real browser tab (the handoff page, or the Meetings page itself), so that's safe here.
// The one piece of genuinely DOM-touching work this file needs — writing to the
// clipboard, which falls back to a hidden-textarea/execCommand technique on top of
// navigator.clipboard — still isn't imported directly: it's injected as the
// `writeToClipboard` callback, so this file never reaches into src/ (the established
// import direction is src/ → extension/, never the reverse).

import { buildMarkdown, buildFilename } from "./markdown.js"
import { buildObsidianUri, joinObsidianPath } from "./uri.js"
import { enrichWithLlm } from "./llm.js"
import { getMeetingById, updateMeetingById, getObsidianSettings, acquireClipboardLock, releaseClipboardLock } from "./store.js"

/**
 * @typedef {Object} SaveFlowCallbacks
 * @property {(stepId: SaveFlowStepId, status: SaveFlowStepStatus, detail?: string) => void} onStep called at every step transition — callers own their own presentation (a full step list vs. a single rotating label), this only reports stable id+status+an optional short detail
 * @property {(text: string) => Promise<boolean>} writeToClipboard
 * @property {(meeting: Meeting) => void} [onMeetingLoaded] called once, right after the meeting is fetched — only the standalone handoff page needs this (to display the meeting's title, since it otherwise never sees the `Meeting` object); the Meetings page already has `meeting` as a prop, so it omits this
 * @property {AbortSignal} [signal] lets a caller (e.g. a Stop button) cancel the in-flight LLM request — see enrichWithLlm()'s own `signal` param. Only the `llm` step is actually cancelable; every other step is a fast, local operation.
 */

/**
 * @typedef {
 *   | { success: true, mode: "inline" | "clipboard" }
 *   | { success: false, retryable: boolean, message: ErrorObject, contextExceeded?: { requiredTokens: number, loadedContextLength?: number }, stopped?: boolean }
 * } SaveFlowResult
 */

/**
 * @param {Awaited<ReturnType<typeof enrichWithLlm>>} result
 * @returns {result is { contextExceeded: true, requiredTokens: number, loadedContextLength?: number }}
 */
function isContextExceeded(result) {
    return result !== null && typeof result === "object" && "contextExceeded" in result
}

/**
 * @param {Awaited<ReturnType<typeof enrichWithLlm>>} result
 * @returns {result is { stopped: true }}
 */
function isStopped(result) {
    return result !== null && typeof result === "object" && "stopped" in result
}

/**
 * Runs the full "Save to Obsidian" flow for one meeting: load it, optionally enrich it
 * with a local LLM summary (or reuse an already-cached one — see the comment below, this
 * is what protects a user's checked-off action items from being silently regenerated
 * away), build the note markdown, deliver it (clipboard or inline), then navigate to the
 * `obsidian://` URI to hand off to the Obsidian app. Never throws — every failure mode
 * resolves to a `{success: false, ...}` result instead, matching enrichWithLlm()'s own
 * "never throw" contract one layer up.
 * @param {string} meetingId
 * @param {SaveFlowCallbacks} callbacks
 * @returns {Promise<SaveFlowResult>}
 */
export async function runSaveToObsidianFlow(meetingId, { onStep, writeToClipboard, onMeetingLoaded, signal }) {
    onStep("load", "active")
    const [meeting, settings] = await Promise.all([getMeetingById(meetingId), getObsidianSettings()])

    if (!meeting) {
        onStep("load", "failed", "Meeting not found.")
        await markStatus(meetingId, "failed")
        return {
            success: false,
            retryable: false,
            message: { errorCode: "017", errorMessage: "Meeting not found — it may have been deleted from history." },
        }
    }
    onMeetingLoaded?.(meeting)
    onStep("load", "done")

    if (!settings.obsidianVaultName) {
        onStep("markdown", "skipped")
        onStep("llm", "skipped")
        onStep("deliver", "skipped")
        onStep("launch", "failed", "No Obsidian vault configured.")
        await markStatus(meetingId, "failed")
        return {
            success: false,
            retryable: false,
            message: {
                errorCode: "018",
                errorMessage: "No Obsidian vault configured. Go to the meetings page and set a vault name first.",
            },
        }
    }

    // Optional local LLM enrichment (Phase 4). enrichWithLlm() is documented to NEVER
    // throw. It resolves to `null` on most failures (meaning "skip enrichment, continue
    // with the plain transcript"), or to a distinct `{contextExceeded: true, ...}` shape
    // for the one failure mode that's actionable by the user right now — the model being
    // loaded with less context than this transcript needs — which is handled as a hard
    // stop below instead of a silent fallback. The try/catch here is deliberate
    // defense-in-depth on top of that guarantee (see PLAN.md §8), so an unforeseen bug in
    // llm.js can never take down the plain-transcript export path.
    /** @type {{ title?: string, summaryMarkdown: string, properties: ResolvedProperty[], includesTranscript: boolean, includesChatMessages: boolean } | null} */
    let llmResult = null
    if (meeting.llmSummaryMarkdown) {
        // A summary was already generated for this meeting — reuse it as-is rather than
        // calling the LLM again. Regenerating here would silently discard any edits made
        // in the Summary tab (e.g. action items checked off via toggleActionItemDone(),
        // see parse-summary-markdown.ts) since a fresh enrichWithLlm() run has no way to
        // know about them.
        llmResult = {
            title: meeting.llmSummaryTitle,
            summaryMarkdown: meeting.llmSummaryMarkdown,
            properties: [],
            includesTranscript: meeting.llmSummaryIncludesTranscript ?? false,
            includesChatMessages: meeting.llmSummaryIncludesChatMessages ?? false,
        }
        onStep("llm", "done", "Using the existing summary, including your edits.")
    } else if (settings.obsidianUseLlm && !settings.obsidianLlmAutoRun) {
        onStep("llm", "skipped", 'Auto-run is off — use "Summarize" from the meeting\'s menu on the Meetings page instead.')
    } else if (settings.obsidianUseLlm) {
        onStep("llm", "active")
        /** @type {Awaited<ReturnType<typeof enrichWithLlm>>} */
        let rawLlmResult = null
        try {
            rawLlmResult = await enrichWithLlm(meeting, settings, signal)
        } catch (err) {
            console.error("[save-flow] LLM enrichment threw unexpectedly (falling back to plain note)", err)
            rawLlmResult = null
        }

        if (isStopped(rawLlmResult)) {
            // Unlike every other failure mode here, a user-triggered Stop must stop the
            // whole operation, not silently fall back to a plain-transcript export.
            onStep("llm", "failed", "Stopped.")
            onStep("markdown", "skipped")
            onStep("deliver", "skipped")
            onStep("launch", "skipped")
            await markStatus(meetingId, "failed")
            return {
                success: false,
                retryable: true,
                stopped: true,
                message: { errorCode: "022", errorMessage: "Stopped." },
            }
        }

        if (isContextExceeded(rawLlmResult)) {
            const { requiredTokens, loadedContextLength } = rawLlmResult
            onStep(
                "llm",
                "failed",
                loadedContextLength !== undefined
                    ? `Needs ~${requiredTokens.toLocaleString()} tokens; model loaded with ${loadedContextLength.toLocaleString()}.`
                    : `Needs ~${requiredTokens.toLocaleString()} tokens; the server rejected the request for exceeding context.`,
            )
            onStep("markdown", "skipped")
            onStep("deliver", "skipped")
            onStep("launch", "skipped")
            await markStatus(meetingId, "failed")
            return {
                success: false,
                retryable: true,
                contextExceeded: { requiredTokens, loadedContextLength },
                message: {
                    errorCode: "019",
                    errorMessage:
                        loadedContextLength !== undefined
                            ? `This meeting needs about ${requiredTokens.toLocaleString()} tokens of context, but the model ` +
                              `is currently loaded in LM Studio with only ${loadedContextLength.toLocaleString()}. Load the ` +
                              `model with a larger context length (LM Studio → Developer tab → select the model → Context ` +
                              `Length) and try again.`
                            : `This meeting needs about ${requiredTokens.toLocaleString()} tokens of context, and the server ` +
                              `rejected the request for exceeding its context length. Increase the model's context length ` +
                              `in your provider and try again.`,
                },
            }
        }

        llmResult = rawLlmResult
        if (llmResult) {
            onStep("llm", "done")
            await markSummaryCache(meetingId, llmResult)
        } else {
            onStep(
                "llm",
                "skipped",
                "Local LLM unavailable or returned nothing usable — continuing with the plain transcript.",
            )
        }
    } else {
        onStep("llm", "skipped", "Local LLM summary enrichment is off.")
    }

    onStep("markdown", "active")
    const content = buildMarkdown(
        meeting,
        llmResult
            ? {
                  overrideTitle: llmResult.title,
                  summaryMarkdown: llmResult.summaryMarkdown,
                  resolvedProperties: llmResult.properties,
                  suppressTranscriptSection: llmResult.includesTranscript,
                  suppressChatSection: llmResult.includesChatMessages,
              }
            : undefined,
    )
    const filename = buildFilename(settings.obsidianFileNameTemplate, meeting, { aiTitle: llmResult?.title })
    const filePath = joinObsidianPath(settings.obsidianFolder, filename)
    const built = buildObsidianUri({ vault: settings.obsidianVaultName, filePath, content })
    onStep("markdown", "done")

    if (built.mode === "clipboard") {
        onStep("deliver", "active", "Copying to clipboard…")
        const locked = await acquireClipboardLock()
        if (!locked) {
            onStep("deliver", "failed", "Another Obsidian export is already in progress.")
            onStep("launch", "skipped")
            await markStatus(meetingId, "failed")
            return {
                success: false,
                retryable: true,
                message: {
                    errorCode: "020",
                    errorMessage:
                        'Another Obsidian export is already in progress. Please retry "Save to Obsidian" for this meeting in a few seconds.',
                },
            }
        }

        // The handoff tab is opened via chrome.tabs.create() right as a Meet call ends,
        // and the browser doesn't always bring it (or its window) into focus immediately
        // — navigator.clipboard.writeText() throws a NotAllowedError/DOMException in an
        // unfocused document. Force focus first (best-effort, non-fatal) — a no-op in
        // practice for the Meetings page's own inline Run, which is already focused since
        // the user just clicked it, but harmless to run unconditionally here rather than
        // special-casing per caller.
        await focusThisWindow()

        const clipboardText = built.content ?? content
        const copied = await writeToClipboard(clipboardText)

        if (!copied) {
            onStep("deliver", "failed", "Could not copy the note to the clipboard.")
            onStep("launch", "skipped")
            await markStatus(meetingId, "failed")
            await releaseClipboardLock()
            return {
                success: false,
                retryable: true,
                message: {
                    errorCode: "021",
                    errorMessage: 'Could not copy the note to the clipboard. Please retry "Save to Obsidian" for this meeting.',
                },
            }
        }
        onStep("deliver", "done")
    } else {
        onStep("deliver", "skipped", "Note is short enough to send inline.")
    }

    onStep("launch", "active")
    await markStatus(meetingId, "handed_off")

    // Navigate this tab itself (not window.open) so Chrome's native "Open Obsidian?"
    // confirmation has a real, focused tab to attach to. A custom URI scheme like this
    // doesn't unload the current page (same as a mailto: link) — safe to call on a
    // long-lived tab (the Meetings page), not just the disposable handoff tab this used
    // to be exclusive to.
    window.location.href = built.uri

    if (built.mode === "clipboard") {
        // Give the OS/Obsidian a moment to actually read the clipboard before releasing
        // the lock — see the TTL/race caveat documented in store.js.
        setTimeout(() => {
            releaseClipboardLock()
        }, 5000)
    }

    onStep("launch", "done")
    return { success: true, mode: built.mode }
}

// Best-effort attempt to bring this tab's window into focus before writing to the
// clipboard. navigator.clipboard.writeText() requires document focus. Never let a
// failure here (e.g. missing "windows" permission, already focused, etc.) block the flow.
async function focusThisWindow() {
    try {
        const win = await chrome.windows.getCurrent()
        if (win.id !== undefined && win.id !== chrome.windows.WINDOW_ID_NONE) {
            await chrome.windows.update(win.id, { focused: true })
        }
        // Give the browser a beat to actually apply focus before the clipboard write.
        await new Promise((resolve) => setTimeout(resolve, 150))
    } catch (err) {
        console.warn("[save-flow] could not force window focus (continuing anyway)", err)
    }
}

/**
 * @param {string} meetingId
 * @param {ObsidianSaveStatus} status
 */
async function markStatus(meetingId, status) {
    try {
        await updateMeetingById(meetingId, () => ({ obsidianSaveStatus: status }))
    } catch (err) {
        // Non-fatal: the handoff itself may have already succeeded (or failed) by the
        // time this bookkeeping write fails. Never let this throw block the flow.
        console.error("[save-flow] failed to update meeting status", err)
    }
}

/**
 * @param {string} meetingId
 * @param {{ title?: string, summaryMarkdown: string, includesTranscript: boolean, includesChatMessages: boolean }} llmResult
 */
async function markSummaryCache(meetingId, llmResult) {
    try {
        await updateMeetingById(meetingId, () => ({
            llmSummaryMarkdown: llmResult.summaryMarkdown,
            llmSummaryIncludesTranscript: llmResult.includesTranscript,
            llmSummaryIncludesChatMessages: llmResult.includesChatMessages,
            ...(llmResult.title ? { llmSummaryTitle: llmResult.title } : {}),
        }))
    } catch (err) {
        console.error("[save-flow] failed to cache LLM summary (non-fatal)", err)
    }
}
