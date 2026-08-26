// Additive JSDoc typedefs for the Obsidian export feature (Phase 3).
// Kept in a separate file from types/index.js per PLAN.md Phase 2: "Extend types/index.js
// (or add types/obsidian.js) additively for new message types — never alter existing
// typedef shapes."

/**
 * @typedef {boolean} AutoSaveToObsidianAfterMeeting Whether to automatically hand off the transcript to Obsidian after each meeting.
 */
/**
 * @typedef {string} ObsidianVaultName Must exactly match the vault's name as shown in Obsidian's vault switcher.
 */
/**
 * @typedef {string} ObsidianFolder Vault-relative destination folder. Empty string means vault root.
 */
/**
 * @typedef {string} ObsidianFileNameTemplate Filename template supporting {{date}} {{time}} {{title}} {{software}} tokens.
 */

/**
 * @typedef {Object} ObsidianSettings
 * @property {AutoSaveToObsidianAfterMeeting} autoSaveToObsidianAfterMeeting
 * @property {ObsidianVaultName} obsidianVaultName
 * @property {ObsidianFolder} obsidianFolder
 * @property {ObsidianFileNameTemplate} obsidianFileNameTemplate
 */

/**
 * @typedef {"pending" | "handed_off" | "failed"} ObsidianSaveStatus
 * Status of a meeting's handoff to Obsidian. "handed_off" is optimistic — the
 * `obsidian://` URI scheme has no delivery callback, so this only means the extension
 * successfully launched (or queued via clipboard) the handoff, never that the .md file
 * was confirmed written into the vault.
 */

/**
 * @typedef {Object} BuiltObsidianUri
 * @property {"inline" | "clipboard"} mode
 * @property {string} uri the obsidian://new?... URI to navigate to
 * @property {string} [content] present only when mode is "clipboard" — the note body the caller must write to the OS clipboard before navigating to `uri`
 */

/**
 * @typedef {Object} MarkdownBuildOptions
 * @property {string} [overrideTitle] use this instead of the meeting's own title (reserved for Phase 4 LLM-derived titles; unused in Phase 3)
 * @property {string} [summaryMarkdown] extra markdown injected after the frontmatter, before the transcript (reserved for Phase 4; unused in Phase 3)
 */
