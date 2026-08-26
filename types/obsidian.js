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
 * @typedef {boolean} ObsidianUseLlm Whether to enrich the note with a local LLM-generated summary before handing off to Obsidian (Phase 4).
 */
/**
 * @typedef {string} ObsidianLlmEndpoint OpenAI-chat-completions-compatible endpoint of a locally-running LLM server (e.g. LM Studio or Ollama).
 */
/**
 * @typedef {string} ObsidianLlmModel Model name/identifier as known to the local LLM server. No hardcoded default tied to one specific model — the user must set this to whatever they've pulled locally.
 */
/**
 * @typedef {number} ObsidianLlmTimeoutMs Milliseconds to wait for the local LLM server to respond before aborting and falling back to the plain transcript note.
 */

/**
 * @typedef {Object} ObsidianSettings
 * @property {AutoSaveToObsidianAfterMeeting} autoSaveToObsidianAfterMeeting
 * @property {ObsidianVaultName} obsidianVaultName
 * @property {ObsidianFolder} obsidianFolder
 * @property {ObsidianFileNameTemplate} obsidianFileNameTemplate
 * @property {ObsidianUseLlm} obsidianUseLlm added in Phase 4
 * @property {ObsidianLlmEndpoint} obsidianLlmEndpoint added in Phase 4
 * @property {ObsidianLlmModel} obsidianLlmModel added in Phase 4
 * @property {ObsidianLlmTimeoutMs} obsidianLlmTimeoutMs added in Phase 4
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
