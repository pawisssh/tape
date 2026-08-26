// @ts-check
/// <reference path="../../types/chrome.d.ts" />
/// <reference path="../../types/index.js" />
/// <reference path="../../types/obsidian.js" />

// Orchestrates the Obsidian handoff flow described in PLAN.md §5:
//   1. load meeting + settings
//   2. buildMarkdown(meeting)
//   3. (Phase 4, not implemented yet) optional LLM enrichment
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

    setStatus("Building note…")
    const content = buildMarkdown(meeting)
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
