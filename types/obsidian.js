// Additive JSDoc typedefs for the Obsidian export feature (Phase 3).
// Kept in a separate file from types/index.js per PLAN.md Phase 2: "Extend types/index.js
// (or add types/obsidian.js) additively for new message types — never alter existing
// typedef shapes."

/**
 * @typedef {boolean} AutoSaveToObsidianAfterMeeting Whether to automatically hand off the transcript to Obsidian after each meeting. Not a stored preference — derived by getObsidianSettings() from whether `obsidianVaultName` is configured, so it turns on the moment a vault name is entered with no separate toggle to flip.
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
 * @typedef {string} ObsidianLlmEndpoint OpenAI-chat-completions-compatible endpoint, resolved from the active provider (see LlmProviderConfig/getObsidianSettings) — `${activeProvider.baseUrl}/chat/completions`, or `""` if no provider/model is currently active.
 */
/**
 * @typedef {string} ObsidianLlmModel Model id, resolved from the active model selection (see ObsidianLlmActiveModel). Empty string if none is active.
 */
/**
 * @typedef {string} ObsidianLlmApiKey Optional API key of the active provider, resolved the same way as ObsidianLlmEndpoint/ObsidianLlmModel. Sent as `Authorization: Bearer <key>` by enrichWithLlm()/getLoadedContextLength() when present; omitted entirely for providers (typically local ones) that don't have one configured.
 */
/**
 * @typedef {number} ObsidianLlmTimeoutMs Milliseconds to wait for the local LLM server to respond before aborting and falling back to the plain transcript note.
 */
/**
 * @typedef {boolean} ObsidianLlmAutoRun Whether LLM summarization runs automatically as part of the Obsidian handoff. When `false`, the handoff skips it (falls straight to the plain transcript note) and the user is expected to trigger it manually instead — see the "summarize_meeting_now" message, handled by summarizeMeetingNow() in extension/background-script/meetings.js.
 */
/**
 * @typedef {string} ObsidianLlmSystemPrompt The full `role: "system"` message text sent to the LLM ahead of every summarization request (see enrichWithLlm() in extension/obsidian/llm.js) — user-editable on the Settings page's AI summary category, a full replace rather than an addendum to the built-in prompt. Empty/unset falls back to interpreter.js's INTERPRETER_SYSTEM_PROMPT (see getObsidianSettings()). Editing out its "respond with exactly one JSON object" instruction breaks summarization's response parsing — the Settings UI's "Reset to default" button is the recovery path, not a code-level guard.
 */
/**
 * @typedef {"lmstudio" | "ollama" | "custom"} ObsidianLlmProviderType Which preset (if any) a saved LlmProviderConfig was created from. "lmstudio"/"ollama" just prefill name+baseUrl in the provider dialog (both live under the "Local" card on the Integrations page) — every type is sent through the same OpenAI-chat-completions-shaped request in llm.js (no native Anthropic Messages API support; point "custom" at any other OpenAI-compatible provider, cloud or otherwise, instead).
 */
/**
 * @typedef {Object} LlmProviderConfig One saved LLM connector, persisted in chrome.storage.local (see extension/obsidian/providers.js) — deliberately NOT .sync, since `apiKey` is a secret.
 * @property {string} id Stable id (crypto.randomUUID()), assigned on first save.
 * @property {ObsidianLlmProviderType} type
 * @property {string} name Display name shown in the Providers list.
 * @property {string} baseUrl Always WITHOUT a trailing path — callers uniformly build `${baseUrl}/chat/completions` and `${baseUrl}/models` from this.
 * @property {string} [apiKey] Optional. Sent as `Authorization: Bearer <apiKey>` when present.
 */
/**
 * @typedef {Object} ObsidianLlmActiveModel Which one model, across all saved providers, is currently selected to actually summarize with — see providers.js's getActiveModel()/setActiveModel(). Persisted in chrome.storage.local, absent when no model has been picked yet.
 * @property {string} providerId matches one LlmProviderConfig.id
 * @property {string} modelId
 */
/**
 * @typedef {"text" | "multitext" | "date" | "number" | "checkbox"} TemplatePropertyType Mirrors Obsidian's own property types — drives both the Templates UI's type selector and how renderFrontmatterField() (markdown.js) renders the resolved value as YAML (multitext -> a list, everything else -> a scalar).
 */
/**
 * @typedef {Object} TemplateProperty One frontmatter field contributed by a SummaryTemplate, merged into buildFrontmatter()'s baseline fields by `name` (see markdown.js's mergeFrontmatterFields()).
 * @property {string} name Frontmatter/YAML key.
 * @property {string} value A template string — may contain {{variable}} and {{"AI instruction"|filter}} tokens (see extension/obsidian/interpreter.js), or plain literal text.
 * @property {TemplatePropertyType} type
 */
/**
 * @typedef {Object} ResolvedProperty One TemplateProperty after interpreter.js has resolved its `value` template against a specific meeting/LLM response.
 * @property {string} name
 * @property {string | string[]} value string for every type except multitext, which resolves to an array (see interpreter.js's resolvePropertyValue()).
 * @property {TemplatePropertyType} type
 */
/**
 * @typedef {Object} SummaryTemplate One saved summary template, persisted in chrome.storage.sync (see extension/obsidian/templates.js) — auto-selected per meeting by resolveTemplateForTitle() based on `keywords` matching the meeting title. Not a secret, syncs across the user's machines like any other preference.
 * @property {string} id Stable id (crypto.randomUUID()), assigned on first save. The built-in DEFAULT_TEMPLATE (templates.js) uses the reserved id "default" and is never persisted.
 * @property {string} name Display name shown in the Templates list.
 * @property {string} keywords Comma-separated, case-insensitive substring match against the meeting title. Empty string means "use as the fallback template when nothing else matches."
 * @property {TemplateProperty[]} properties Frontmatter fields this template contributes — see markdown.js's buildFrontmatter().
 * @property {string} noteContent Template string for the note body (replaces the old fixed six-section renderer) — resolved by interpreter.js's resolveValue().
 * @property {string} [systemPrompt] DEPRECATED legacy field from before the Properties/Note-content redesign — inert, read only by templates.js's migrateLegacyTemplate() as a marker that a template needs one-time default seeding; never sent to the model.
 */

/**
 * @typedef {Object} ObsidianSettings
 * @property {AutoSaveToObsidianAfterMeeting} autoSaveToObsidianAfterMeeting
 * @property {ObsidianVaultName} obsidianVaultName
 * @property {ObsidianFolder} obsidianFolder
 * @property {ObsidianFileNameTemplate} obsidianFileNameTemplate
 * @property {ObsidianUseLlm} obsidianUseLlm added in Phase 4
 * @property {ObsidianLlmEndpoint} obsidianLlmEndpoint added in Phase 4, now resolved from the active provider
 * @property {ObsidianLlmModel} obsidianLlmModel added in Phase 4, now resolved from the active model
 * @property {ObsidianLlmApiKey | undefined} obsidianLlmApiKey resolved from the active provider
 * @property {ObsidianLlmTimeoutMs} obsidianLlmTimeoutMs added in Phase 4
 * @property {ObsidianLlmAutoRun} obsidianLlmAutoRun
 * @property {SummaryTemplate[]} obsidianLlmSummaryTemplates per-meeting-type prompt overrides — see resolveTemplateForTitle() in extension/obsidian/templates.js
 * @property {ObsidianLlmSystemPrompt} obsidianLlmSystemPrompt
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
 * @typedef {"load" | "llm" | "markdown" | "deliver" | "launch"} SaveFlowStepId
 * The phases of extension/obsidian/save-flow.js's runSaveToObsidianFlow() — shared by
 * its two callers (src/obsidian-handoff/App.tsx's step list, and the Meetings page's
 * inline "Run" progress bar), each of which owns its own wording for these ids.
 */

/** @typedef {"active" | "done" | "skipped" | "failed"} SaveFlowStepStatus */

/**
 * @typedef {Object} MarkdownBuildOptions
 * @property {string} [overrideTitle] use this instead of the meeting's own title (LLM-derived, from enrichWithLlm's resolved "title" property)
 * @property {string} [summaryMarkdown] extra markdown injected after the frontmatter, before the transcript — enrichWithLlm's resolved `noteContent`
 * @property {ResolvedProperty[]} [resolvedProperties] frontmatter fields to merge on top of buildFrontmatter()'s baseline, by name — defaults to `[]` (baseline-only output, byte-identical to pre-Templates-redesign behavior) when omitted
 * @property {boolean} [suppressTranscriptSection] set when the resolved `summaryMarkdown` already included the transcript itself (the matched template's noteContent referenced {{transcript}} — see interpreter.js's templateReferencesVariable()), so buildMarkdown()'s own automatic "## Transcript" append is skipped instead of duplicating it. Defaults to `false` (always append), the same as before this option existed.
 * @property {boolean} [suppressChatSection] same as suppressTranscriptSection, for {{chatMessages}}/"## Chat messages".
 * @property {boolean} [suppressNotesSection] same as suppressTranscriptSection, for the user's Notes-tab content/"## Notes" — currently unused (no template variable exposes {{userNotes}} yet), present for symmetry with the other two suppress flags.
 */
