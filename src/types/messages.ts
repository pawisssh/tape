// React-side type surface for extension messaging (Phase 5).
//
// types/index.js and types/obsidian.js are plain scripts (no import/export statements),
// so TypeScript treats every JSDoc @typedef declared in them as a GLOBAL ambient type —
// visible by name in any .ts/.tsx file covered by the same tsconfig program, with no
// import required. This file exists (per PLAN.md §7's target file structure) as the
// single documented place that re-affirms which of those ambient types the React layer
// relies on, plus any types that only make sense on the UI side.
//
// Do not redeclare or duplicate shapes already defined via JSDoc in types/index.js /
// types/obsidian.js — extend additively over there if the shape itself needs to change
// (see PLAN.md §6 Phase 2). This file only adds UI-only view types.

/// <reference path="../../types/index.js" />
/// <reference path="../../types/obsidian.js" />

// Re-exported for convenience so components can write
// `import type { Meeting, ObsidianSettings } from "@/types/messages"` instead of relying
// on ambient global lookup, without duplicating the underlying shape.
export type MessageMeeting = Meeting
export type MessageObsidianSettings = ObsidianSettings
export type MessageExtensionMessage = ExtensionMessage
export type MessageExtensionResponse = ExtensionResponse
export type MessageErrorObject = ErrorObject
export type MessagePlatform = Platform
export type MessageResultLocal = ResultLocal
export type MessageResultSync = ResultSync

/** Union of the meeting-table export statuses shown in the UI, derived (not stored) from a Meeting's `webhookPostStatus`. */
export type WebhookStatusView = Meeting["webhookPostStatus"]

/** Union of the Obsidian handoff statuses shown in the UI, defaulting to "not_sent" when `obsidianSaveStatus` is absent. */
export type ObsidianStatusView = NonNullable<Meeting["obsidianSaveStatus"]> | "not_sent"
