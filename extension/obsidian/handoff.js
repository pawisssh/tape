// @ts-check
/// <reference path="../../types/chrome.d.ts" />
/// <reference path="../../types/index.js" />
/// <reference path="../../types/obsidian.js" />

// Orchestrates the Obsidian handoff flow described in PLAN.md §5:
//   1. load meeting + settings
//   2. buildMarkdown(meeting)
//   3. optional LLM enrichment (Phase 4) — see enrichWithLlm() call below
//   4. decide inline content= vs. clipboard delivery
//   5. navigate to obsidian://new?vault=...&file=...&content=...
//   6. mark meeting.obsidianSaveStatus = "handed_off" (optimistic, no delivery confirmation)
//
// This has to be a real, standalone extension page — not the service worker — because:
// an MV3 service worker is killed ~30s after its last extension-API call (too short for
// a slow local LLM call in Phase 4); it has no clipboard access; launching a custom-
// protocol URI needs a real, focused tab (the meeting tab may have just closed); and a
// stable extension-origin page is what lets Chrome remember "Always allow" for the
// obsidian:// prompt across future meetings.

import { buildMarkdown, buildFilename } from "./markdown.js"
import { buildObsidianUri, joinObsidianPath } from "./uri.js"
import { enrichWithLlm } from "./llm.js"
import {
    getMeetingById,
    updateMeetingById,
    getObsidianSettings,
    acquireClipboardLock,
    releaseClipboardLock,
} from "./store.js"

/**
 * @param {string} text
 */
function setStatus(text) {
    const el = document.querySelector("#status")
    if (el) {
        el.textContent = text
    }
    console.log("[obsidian-handoff]", text)
}

/**
 * @param {string} title
 */
function setMeetingTitle(title) {
    const el = document.querySelector("#meeting-title")
    if (el) {
        el.textContent = title
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
        console.error("[obsidian-handoff] failed to update meeting status", err)
    }
}

/**
 * Cache the LLM enrichment result on the meeting record so it can be shown read-only on
 * the history page (meetings.js), independent of whether the Obsidian handoff itself
 * later succeeds. Best-effort — a failure here must never interrupt the handoff flow.
 * @param {string} meetingId
 * @param {{title?: string, summaryMarkdown: string}} llmResult
 */
async function markSummaryCache(meetingId, llmResult) {
    try {
        await updateMeetingById(meetingId, () => ({
            llmSummaryMarkdown: llmResult.summaryMarkdown,
            ...(llmResult.title ? { llmSummaryTitle: llmResult.title } : {}),
        }))
    } catch (err) {
        console.error("[obsidian-handoff] failed to cache LLM summary (non-fatal)", err)
    }
}

async function run() {
    const params = new URLSearchParams(window.location.search)
    const meetingId = params.get("meetingId")

    if (!meetingId) {
        setStatus("No meeting specified — this page must be opened with a meetingId parameter.")
        return
    }

    setStatus("Loading meeting…")
    const [meeting, settings] = await Promise.all([
        getMeetingById(meetingId),
        getObsidianSettings(),
    ])

    if (!meeting) {
        setStatus("Meeting not found — it may have been deleted from history.")
        return
    }

    setMeetingTitle(meeting.meetingTitle || meeting.title || "Google Meet call")

    if (!settings.obsidianVaultName) {
        setStatus("No Obsidian vault configured. Go to the meetings page and set a vault name first.")
        await markStatus(meetingId, "failed")
        return
    }

    // Step 3 (Phase 4): optional local LLM enrichment. enrichWithLlm() is documented to
    // NEVER throw and to resolve to `null` on any failure whatsoever (server
    // unreachable, timeout, malformed JSON, etc.) — null just means "skip enrichment".
    // The try/catch here is deliberate defense-in-depth on top of that guarantee (see
    // PLAN.md §8: this is the single property most worth scrutinizing), so that even an
    // unforeseen bug in llm.js can never take down the plain-transcript export path.
    /** @type {{title?: string, summaryMarkdown: string} | null} */
    let llmResult = null
    if (settings.obsidianUseLlm) {
        setStatus("Summarizing with local LLM…")
        try {
            llmResult = await enrichWithLlm(meeting, settings)
        } catch (err) {
            console.error("[obsidian-handoff] LLM enrichment threw unexpectedly (falling back to plain note)", err)
            llmResult = null
        }
        if (llmResult) {
            setStatus("Summary ready. Building note…")
            // Cache the summary on the meeting record so it can be shown read-only on
            // the history page even before/without the Obsidian URI navigation below
            // (e.g. useful if the user later checks meetings.html for this meeting).
            await markSummaryCache(meetingId, llmResult)
        } else {
            setStatus("Local LLM unavailable or returned nothing usable — continuing with the plain transcript…")
        }
    }

    setStatus("Building note…")
    const content = buildMarkdown(meeting, llmResult ? { overrideTitle: llmResult.title, summaryMarkdown: llmResult.summaryMarkdown } : undefined)
    const filename = buildFilename(settings.obsidianFileNameTemplate, meeting)
    const filePath = joinObsidianPath(settings.obsidianFolder, filename)

    const built = buildObsidianUri({ vault: settings.obsidianVaultName, filePath, content })

    if (built.mode === "clipboard") {
        setStatus("Note is large — copying to clipboard before opening Obsidian…")
        const locked = await acquireClipboardLock()
        if (!locked) {
            setStatus("Another Obsidian export is already in progress. Please retry \"Save to Obsidian\" for this meeting in a few seconds.")
            await markStatus(meetingId, "failed")
            return
        }
        try {
            await navigator.clipboard.writeText(built.content ?? content)
        } catch (err) {
            console.error("[obsidian-handoff] clipboard write failed", err)
            setStatus("Could not copy the note to the clipboard. Please retry \"Save to Obsidian\" for this meeting.")
            await markStatus(meetingId, "failed")
            await releaseClipboardLock()
            return
        }
        setStatus("Copied to clipboard. Opening Obsidian — if the note body is empty, paste with Cmd/Ctrl+V.")
    } else {
        setStatus("Opening Obsidian…")
    }

    await markStatus(meetingId, "handed_off")

    // Navigate this tab itself (not window.open) so Chrome's native "Open Obsidian?"
    // confirmation has a real, focused tab to attach to.
    window.location.href = built.uri

    if (built.mode === "clipboard") {
        // Give the OS/Obsidian a moment to actually read the clipboard before releasing
        // the lock — see the TTL/race caveat documented in store.js.
        setTimeout(() => {
            releaseClipboardLock()
        }, 5000)
    }

    setStatus("Done — you can close this tab once Obsidian has opened the note (or answered the \"Open Obsidian?\" prompt).")
}

document.addEventListener("DOMContentLoaded", () => {
    const closeButton = document.querySelector("#close-tab")
    if (closeButton instanceof HTMLButtonElement) {
        closeButton.addEventListener("click", () => {
            window.close()
        })
    }

    run().catch((err) => {
        console.error("[obsidian-handoff] flow failed", err)
        setStatus(`Something went wrong: ${err && err.message ? err.message : String(err)}`)
    })
})
