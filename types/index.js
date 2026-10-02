/**
 * @typedef {"Google Meet" | "Zoom" | "Teams" | "" | undefined} MeetingSoftware Human friendly meeting software name.
 */
/**
 * @typedef {"google_meet" | "teams" | "zoom"} Platform Meeting platform
 */
/**
 * @typedef {number | "processing" | null} MeetingTabId tab id of the meeting tab, captured when meeting starts. A valid value or "processing" indicates that a meeting is in progress. Set to null once meeting ends and associated processing is complete.
 */
/**
 * @typedef {Object} MeetingOperation Which meeting has a Run (save-to-Obsidian) or template-regenerate in flight, and what to label the sticky status bar with. Storage-backed (not plain React state) so it survives switching between the Meetings/Integrations/Templates/Settings pages and the mobile list/detail view — see src/meetings/views/MeetingsView.tsx.
 * @property {string} meetingId stable id (see obsidian/store.js getMeetingId) of the meeting the operation is running for
 * @property {string} label current step's sticky-bar label, e.g. "Summarizing…"
 */
/**
 * @typedef {string} MeetingStartTimestamp ISO timestamp of when the most recent meeting started, dumped by content script
 */
/**
 * @typedef {string} MeetingTitle title of the most recent meeting, dumped by content script
 */
/**
 * @typedef {TranscriptBlock[]} Transcript Transcript of the most recent meeting, dumped by content script
 */
/**
 * @typedef {ChatMessage[]} ChatMessages Chat messages captured during the most recent meeting, dumped by content script
 */
/**
 * @typedef {boolean} IsDeferredUpdatedAvailable whether the extension has a deferred updated waiting to be applied
 */

/**
 * @typedef {boolean} AutoPostWebhookAfterMeeting Whether to automatically post the webhook after each meeting
 */
/**
 * @typedef {boolean} AutoDownloadFileAfterMeeting Whether to automatically download the transcript file after each meeting
 */
/**
 * @typedef {"auto" | "manual" | "off"} OperationMode mode of the extension which decides whether to automatically capture transcripts, let the user decide per meeting basis, or not capture at all. Checked once at meeting-join time in each platform's content script (google-meet/teams/zoom index.js) — "off" skips starting capture routines entirely for that meeting. Also the single source of truth for the Meetings page sidebar's record-dot color/on-off switch (see SidebarStatusBar.tsx/App.tsx), replacing the former separate, purely-cosmetic AutoCaptureEnabled setting.
 */
/**
 * @typedef {boolean} HideCaptions hide the captions on the UI by changing height and opacity
 */
/**
 * @typedef {"simple" | "advanced"} WebhookBodyType type of webhook body to use
 */
/**
 * @typedef {string} WebhookUrl URL of the webhook
 */
/**
 * @typedef {boolean} WantGoogleMeet Indicates whether user explicitly opted in for Google Meet. Does not necessarily mean Google Meet is enabled for them. Only an indicator to re-inject content scripts between reloads.
 */
/**
 * @typedef {boolean} WantTeams Indicates whether user explicitly opted in for Teams. Does not necessarily mean Teams is enabled for them. Only an indicator to re-inject content scripts between reloads.
 */
/**
 * @typedef {boolean} WantZoom Indicates whether user explicitly opted in for Zoom. Does not necessarily mean Zoom is enabled for them. Only an indicator to re-inject content scripts between reloads.
 */






/**
 * @typedef {Object} TranscriptBlock A chunk of transcript
 * @property {string} personName name of the person who spoke
 * @property {string} timestamp ISO timestamp of when the words were spoken
 * @property {string} transcriptText actual transcript text
 */

/**
 * @typedef {Object} ChatMessage A chat message
 * @property {string} personName name of the person who sent the message
 * @property {string} timestamp ISO timestamp of when the message was sent
 * @property {string} chatMessageText actual message text
 */

/**
 * @typedef {Object} CommentNoteEntry A quick note the user typed during the meeting via the
 * floating widget's Note tab (see extension/content-scripts/live-panel.js).
 * Merged into the finalized meeting's userNotes at meeting end — see
 * formatCommentNotesAsUserNotes() in extension/background-script/utils.js.
 * @property {string} timestamp ISO timestamp of when the note was saved
 * @property {string} text the note text
 * @property {{personName: string, timestamp: string, transcriptText: string, blockIndex: number}} [linkedTranscript] the selected transcript block, snapshotted when the note was saved
 */

/**
 * @typedef {Object} WebhookBody
 * @property {"simple" | "advanced"} webhookBodyType simple or advanced
 * @property {MeetingSoftware} meetingSoftware
 * @property {string} meetingTitle title of the meeting
 * @property {string} meetingStartTimestamp ISO timestamp of when the meeting started
 * @property {string} meetingEndTimestamp ISO timestamp of when the meeting ended
 * @property {TranscriptBlock[] | string} transcript transcript as a formatted string or array containing transcript blocks from the meeting
 * @property {ChatMessage[] | string} chatMessages chat messages as a formatted string or array containing chat messages from the meeting
 */

/**
 * @typedef {Object} ExtensionStatusJSON
 * @property {number} status status of the extension
 * @property {string} message message of the status
 * @property {boolean} [showBetaMessage] show beta enablement
*/
/**
 * @typedef {Object} Meeting
 * @property {MeetingSoftware} [meetingSoftware]
 * @property {string | undefined} [meetingTitle] title of the meeting
 * @property {string | undefined} [title] title of the meeting (this is older key for meetingTitle key, in v3.1.0)
 * @property {string} meetingStartTimestamp ISO timestamp of when the meeting started
 * @property {string} meetingEndTimestamp ISO timestamp of when the meeting ended
 * @property {TranscriptBlock[] | []} transcript array containing transcript blocks from the meeting
 * @property {ChatMessage[] | []} chatMessages array containing chat messages from the meeting
 * @property {"new" | "failed" | "successful"} webhookPostStatus status of the webhook post request
 * @property {ObsidianSaveStatus} [obsidianSaveStatus] status of handoff to Obsidian (added in Phase 3, additive/optional — absent means Obsidian export was never attempted for this meeting)
 * @property {string} [llmSummaryMarkdown] rendered LLM summary markdown fragment, cached from the most recent successful enrichment (added in Phase 4, additive/optional — absent means LLM enrichment was never attempted or never succeeded for this meeting)
 * @property {string} [llmSummaryTitle] LLM-suggested title from the most recent successful enrichment (added in Phase 4, additive/optional)
 * @property {boolean} [llmSummaryIncludesTranscript] whether llmSummaryMarkdown already embeds a {{transcript}} section of its own, cached alongside it so a later Obsidian export that reuses this cached summary (see src/obsidian-handoff/App.tsx) knows not to append a second, redundant Transcript section. Additive/optional — absent is treated as false.
 * @property {boolean} [llmSummaryIncludesChatMessages] same as llmSummaryIncludesTranscript, for a {{chatMessages}} section. Additive/optional — absent is treated as false.
 * @property {string} [templateOverrideId] id of a SummaryTemplate (or the literal "default") the user explicitly picked for THIS meeting via the header toolbar's Follow-up picker (src/meetings/agenda/FollowUpTemplatePicker.tsx), overriding resolveTemplateForTitle()'s automatic keyword match — see extension/obsidian/llm.js's enrichWithLlm(). Added in the visual redesign, additive/optional — absent means "use automatic resolution as before." A stale id (template since deleted) falls back to automatic resolution rather than erroring.
 * @property {string} [userNotes] freeform per-meeting notes the user typed directly in the Notes tab — no AI involvement, plain user-authored text. Added in the visual redesign, additive/optional — absent/empty means no notes. Exported to Obsidian as the last section of the note, after Transcript/Chat messages — see extension/obsidian/markdown.js's renderNotesSection()/buildMarkdown().
 */

/** @typedef {Object} StateTranscriptBlock
 * @property  {string} timestamp
 * @property {Element | null} mutationTargetElement
 * @property  {string} personName
 * @property  {string} transcriptTextBuffer
*/

/**
 * @typedef {Object} ContentScriptState
 * @property {MeetingSoftware} meetingSoftware
 * @property {Platform} platform
 * @property {string} userName
 * @property {TranscriptBlock[]} transcript array containing transcript blocks from the meeting
 * @property {ChatMessage[]} chatMessages array containing chat messages from the meeting
 * @property {CommentNoteEntry[]} liveCommentNotes quick notes typed via the floating widget's note panel during the meeting
 * @property {StateTranscriptBlock} stateTranscriptBlock buffer variables to dump values, which get pushed to transcript array as transcript blocks, at defined conditions
 * @property {string | null} meetingStartTimestamp ISO timestamp of when the most recent meeting started, or null before the platform's "meeting started" detection confirms the user has joined
 * @property {string} meetingTitle title of the most recent meeting
 * @property { Element | null} transcriptTargetNode
 * @property { MutationObserver | null} transcriptObserver
 * @property { Element | null} chatMessagesTargetNode
 * @property { MutationObserver | null} chatMessagesObserver
 * @property {boolean} isTranscriptDomErrorCaptured
 * @property {boolean} isChatMessagesDomErrorCaptured
 * @property {boolean} hasMeetingStarted
 * @property {boolean} hasMeetingEnded
 * @property {ExtensionStatusJSON} extensionStatusJSON
 * @property {HTMLIFrameElement | null} [zoomIframe] Zoom only — stashed once found, so a manual capture retry can re-target the transcript container without re-deriving the iframe chain
 */
/**
 * @typedef {Object} ExtensionMessage Message sent by the calling script
 * @property {"new_meeting_started" | "meeting_ended" | "download_transcript_at_index" | "post_webhook_at_index" | "recover_last_meeting" | "get_platform_enablement_status" | "get_platform_permission_status" | "enable_platform" | "disable_platform" | "open_popup" | "open_side_panel" | "broadcast_live_buffer" | "live_assist" | "live_assist_preview" | "get_live_snapshot"} type type of message
 * @property {"rewind" | "recap"} [mode] live assistance action
 * @property {number} [index] index of the meeting to process
 * @property {Platform | Platform[]} [platform] index of the meeting to process
 * @property {StateTranscriptBlock} [stateTranscriptBlock]
*/

/**
 * @typedef {Object} ExtensionResponse Response sent by the called script
 * @property {boolean} [partial] whether a recap still has transcript to process
 * @property {string} [progress] recap progress for the current snapshot
 * @property {string} [model] AI model used
 * @property {string} [capturedAt] snapshot cutoff time
 * @property {boolean} success whether the message was processed successfully as per the request
 * @property {string | string[] | ErrorObject} [message] message explaining success or failure
 */

/**
 * @typedef {Object} ErrorObject Error Object
 * @property {string} errorCode whether the message was processed successfully as per the request
 * @property {string} errorMessage message explaining success or failure
 */




// LOCAL CHROME STORAGE VARIABLES
/**
 * @typedef {Object} ResultLocal Local chrome storage
 * @property {ExtensionStatusJSON} extensionStatusJSON
 * @property {MeetingTabId} meetingTabId
 * @property {MeetingOperation | null | undefined} activeMeetingOperation
 * @property {MeetingSoftware} meetingSoftware
 * @property {MeetingTitle} meetingTitle
 * @property {MeetingStartTimestamp} meetingStartTimestamp
 * @property {Transcript} transcript
 * @property {ChatMessages} chatMessages
 * @property {CommentNoteEntry[] | undefined} liveCommentNotes quick notes typed via the floating widget's note panel during the current meeting, dumped by content script
 * @property {IsDeferredUpdatedAvailable | undefined} isDeferredUpdatedAvailable
 * @property {Meeting[] | undefined} meetings
 * @property {LlmProviderConfig[] | undefined} obsidianLlmProviders saved LLM connectors (see extension/obsidian/providers.js) — local, not sync, since apiKey is a secret
 * @property {ObsidianLlmActiveModel | undefined} obsidianLlmActiveModel which provider+model is currently selected to summarize with
 * @property {{left: number, top: number} | undefined} fabPosition last dragged position of the in-meeting FAB (extension/content-scripts/common-utils.js's renderFab()/makeFabDraggable()), restored on the next meeting/reload
 */

// SYNC CHROME STORAGE VARIABLES
/**
 * @typedef {Object} ResultSync Sync chrome storage
 * @property {AutoPostWebhookAfterMeeting} autoPostWebhookAfterMeeting
 * @property {AutoDownloadFileAfterMeeting} autoDownloadFileAfterMeeting
 * @property {OperationMode} operationMode
 * @property {HideCaptions} hideCaptions
 * @property {WebhookBodyType} webhookBodyType
 * @property {WebhookUrl} webhookUrl
 * @property {WantGoogleMeet} wantGoogleMeet
 * @property {WantTeams} wantTeams
 * @property {WantZoom} wantZoom
 * @property {ObsidianVaultName | undefined} obsidianVaultName added in Phase 3
 * @property {ObsidianFolder | undefined} obsidianFolder added in Phase 3
 * @property {ObsidianFileNameTemplate | undefined} obsidianFileNameTemplate added in Phase 3
 * @property {ObsidianUseLlm | undefined} obsidianUseLlm added in Phase 4
 * @property {ObsidianLlmTimeoutMs | undefined} obsidianLlmTimeoutMs added in Phase 4
 * @property {ObsidianLlmAutoRun | undefined} obsidianLlmAutoRun
 * @property {SummaryTemplate[] | undefined} obsidianLlmSummaryTemplates
 * @property {ObsidianLlmSystemPrompt | undefined} obsidianLlmSystemPrompt
 * @property {DictionaryCategory[] | undefined} obsidianDictionaryCategories
 * @property {DictionaryEntry[] | undefined} obsidianDictionaryWords
*/



// CONTENT SCRIPT ERRORS
// | Error Code | Error Message |
// | :--- | :--- |
// | **001** | "Transcript element not found in DOM" |
// | **002** | "Chat messages element not found in DOM" (currently not in use) |
// | **003** | "Chat button element not found in DOM" |
// | **004** | "Call end button element not found in DOM" |
// | **005** | "Transcript mutation failed to process" |
// | **006** | "Chat messages mutation failed to process" |
// | **007** | "Meeting title element not found in DOM" (currently not in use) |
// | **008** | "Failed to fetch extension status" |
// | **016** | "Recovery timed out" |

// BACKGROUND SCRIPT ERRORS
// | Error Code | Error Message |
// | :--- | :--- |
// | **009** | "Failed to read blob" |
// | **010** | "Meeting at specified index not found" |
// | **011** | "Webhook request failed with HTTP status code [number] [statusText]" |
// | **012** | "No webhook URL configured" |
// | **013** | "No meetings found. May be attend one?" |
// | **014** | "Empty transcript and empty chatMessages" |
// | **015** | "Invalid index" |
// | **017** | "Meeting not found for given id" (added Phase 3, Obsidian handoff) |
// | **018** | "Obsidian vault not configured" (added Phase 3, Obsidian handoff) |
