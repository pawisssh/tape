// @ts-check
/// <reference path="../../types/index.js" />
/// <reference path="../../types/obsidian.js" />

// Pure functions only. No chrome.*, no network. See PLAN.md §8 — this is called out as
// the most failure-prone hand-rolled encoding logic in the whole project.

// There is no single authoritative OS/browser limit on `obsidian://` URI length — this
// travels through Chrome's own URL handling, then the OS's custom-protocol-handler
// dispatch (e.g. Windows ShellExecute, which has a long history of ~2048-character
// practical limits for command-line/URI-ish strings), then Obsidian's own Electron/URL
// parsing. Historical Windows/IE guidance commonly cited ~2083 characters as the safe
// ceiling for a URL passed through the shell. We pick 1800 characters as a conservative
// threshold with headroom under that historical ceiling, applied to the FULL inline URI
// (including the vault= and file= params, not just the encoded content). In practice
// almost any real meeting transcript will exceed this and go through the clipboard path
// below — the inline path mainly matters for short/empty-transcript notes. This is a
// judgment call with no authoritative backing; flagged for tech-lead review per task
// instructions.
export const INLINE_CONTENT_MAX_URI_LENGTH = 1800

/**
 * Join a vault-relative folder and a filename into a single vault-relative path, without
 * mangling either. The folder is trusted user input (an Obsidian folder path they typed
 * themselves) — we only trim stray leading/trailing/duplicate slashes, we do not sanitize
 * its characters the way meeting-derived filename tokens are sanitized in markdown.js.
 * @param {string | undefined | null} folder
 * @param {string} filename already-sanitized filename (see markdown.js buildFilename)
 * @returns {string}
 */
export function joinObsidianPath(folder, filename) {
    const trimmedFolder = (folder || "").split("/").filter(Boolean).join("/")
    return trimmedFolder ? `${trimmedFolder}/${filename}` : filename
}

/**
 * Hand-build an `obsidian://new` URI. Deliberately uses `encodeURIComponent` per
 * parameter rather than `URLSearchParams` — `URLSearchParams` encodes spaces as `+`,
 * which Obsidian treats as a literal `+` character in filenames/content rather than
 * decoding it back to a space. Never emits `overwrite=` or `append=`; relies entirely on
 * Obsidian's own collision-uniquify behavior so this extension can never clobber an
 * existing note.
 * @param {Object} params
 * @param {string} params.vault must exactly match the vault's name in Obsidian's vault switcher
 * @param {string} params.filePath vault-relative path including filename, e.g. "Meetings/2026-08-26 - Standup.md"
 * @param {string} params.content the full note body
 * @returns {BuiltObsidianUri}
 */
export function buildObsidianUri({ vault, filePath, content }) {
    const baseParams = [
        `vault=${encodeURIComponent(vault)}`,
        `file=${encodeURIComponent(filePath)}`,
    ]
    const baseUri = `obsidian://new?${baseParams.join("&")}`

    const inlineUri = `${baseUri}&content=${encodeURIComponent(content)}`

    if (inlineUri.length <= INLINE_CONTENT_MAX_URI_LENGTH) {
        return { mode: "inline", uri: inlineUri }
    }

    return {
        mode: "clipboard",
        uri: `${baseUri}&clipboard=true`,
        content,
    }
}
