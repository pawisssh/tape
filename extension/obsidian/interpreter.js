// @ts-check
/// <reference path="../../types/index.js" />
/// <reference path="../../types/obsidian.js" />

// Obsidian Web Clipper "Interpreter"-style template engine. Pure, framework-free — no
// chrome.*/network dependency, unit-tested directly in tests/interpreter.test.mjs (see
// markdown.js/llm.js for the sibling pattern this follows).
//
// A template string (a SummaryTemplate property `value`, or its `noteContent`) may
// contain {{...}} tokens:
//   - {{variableName}}                 a bare meeting-derived variable, substituted
//                                       directly with no LLM call.
//   - {{"instruction text"}}           a quoted instruction sent to the LLM as part of
//                                       one batched request per meeting (see
//                                       collectInstructions/buildInstructionAnswers).
//   - either form may be followed by one or more |filter or |filter:"args" calls,
//     applied left-to-right to the resolved value before it's substituted in.
//
// Never throws anywhere in this file — an unparseable token, unknown variable, unknown
// filter, or missing instruction answer all degrade gracefully (empty string/no-op)
// rather than erroring, matching the "enrichWithLlm must never throw" contract in llm.js.

import {
    getMeetingTitle,
    formatDuration,
    getParticipants,
    groupTranscriptBySpeaker,
    formatElapsedTime,
    renderTranscriptBody,
    renderChatBody,
} from "./markdown.js"
import { parseTemplateSegments, applyFilters, formatTimestampSuffix, formatAssigneeSuffix } from "./template-syntax.js"
import { outputLanguageInstruction } from "./output-language.js"

// Token parsing (parseTemplateSegments) and the filter pipeline (applyFilters,
// formatTimestampSuffix, formatAssigneeSuffix) live in template-syntax.js — shared with
// markdown.js's buildFilename(), which needs the same {{...}}/filter parsing but can't
// import it from here without a circular import (this file already imports FROM
// markdown.js). Re-export them so every existing importer of interpreter.js (llm.js,
// TemplatesView.tsx, tests) keeps working unchanged.
export { parseTemplateSegments, applyFilters, formatTimestampSuffix, formatAssigneeSuffix }

/** @typedef {import("./template-syntax.js").FilterCall} FilterCall */
/** @typedef {import("./template-syntax.js").TemplateSegment} TemplateSegment */

// ---------------------------------------------------------------------------
// Meeting-derived variables (no webpage exists in this extension's domain, so there is
// no {{url}}/meta:* equivalent — an unknown variable name simply resolves to "").
// ---------------------------------------------------------------------------

/**
 * @param {Meeting} meeting
 * @returns {Record<string, string | string[]>}
 */
export function getMeetingVariables(meeting) {
    const participants = getParticipants(meeting.transcript, meeting.chatMessages)
    return {
        title: getMeetingTitle(meeting),
        date: new Date().toISOString().slice(0, 10),
        meetingStart: meeting.meetingStartTimestamp,
        meetingEnd: meeting.meetingEndTimestamp,
        duration: formatDuration(meeting.meetingStartTimestamp, meeting.meetingEndTimestamp),
        platform: meeting.meetingSoftware || "Meeting",
        participants,
        participantCount: String(participants.length),
        // Body text only, no "## heading" — a noteContent template supplies its own
        // heading (e.g. "## Transcript\n\n{{transcript}}"), same as buildMarkdown's own
        // renderTranscriptSection/renderChatSection do for the plain (no-template) path.
        transcript: renderTranscriptBody(meeting.transcript),
        chatMessages: renderChatBody(meeting.chatMessages),
    }
}

/**
 * Whether `templateString` contains a bare {{variableName}} token (any filters on it
 * don't matter) — used by enrichWithLlm to decide whether buildMarkdown's automatic
 * "## Transcript"/"## Chat messages" append should be skipped because the template
 * already placed that content itself. Never throws.
 * @param {string | undefined | null} templateString
 * @param {string} variableName
 * @returns {boolean}
 */
export function templateReferencesVariable(templateString, variableName) {
    return parseTemplateSegments(templateString).some((seg) => seg.kind === "variable" && seg.name === variableName)
}

// ---------------------------------------------------------------------------
// AI-instruction collection & batching
// ---------------------------------------------------------------------------

/** @typedef {{id: string, instruction: string, listShaped: boolean, timestamped: boolean, assigned: boolean}} CollectedInstruction */

/**
 * Walk every `properties[].value` then `noteContent` in a template, collecting every
 * distinct quoted instruction (deduped by exact trimmed text) into one batch. An
 * instruction's requested shape (plain string / array / timestamped-and-or-assigned
 * object / array of those) is the union of every occurrence's filters — if ANY usage
 * applies `|list`/`|timestamped`/`|assigned`, that shape applies everywhere the same
 * instruction text is reused.
 * @param {SummaryTemplate} template
 * @returns {Map<string, CollectedInstruction>}
 */
export function collectInstructions(template) {
    /** @type {Map<string, CollectedInstruction>} */
    const map = new Map()
    let counter = 0

    /** @param {string} templateString */
    function walk(templateString) {
        for (const seg of parseTemplateSegments(templateString)) {
            if (seg.kind !== "instruction") continue
            const key = seg.instruction.trim()
            if (!key) continue
            const filterNames = seg.filters.map((f) => f.name)
            const hasList = filterNames.includes("list")
            const hasTimestamped = filterNames.includes("timestamped")
            const hasAssigned = filterNames.includes("assigned")
            const existing = map.get(key)
            if (existing) {
                existing.listShaped = existing.listShaped || hasList
                existing.timestamped = existing.timestamped || hasTimestamped
                existing.assigned = existing.assigned || hasAssigned
            } else {
                counter++
                map.set(key, {
                    id: `field_${counter}`,
                    instruction: key,
                    listShaped: hasList,
                    timestamped: hasTimestamped,
                    assigned: hasAssigned,
                })
            }
        }
    }

    for (const prop of (template && template.properties) || []) {
        walk(prop.value || "")
    }
    walk((template && template.noteContent) || "")

    return map
}

// ---------------------------------------------------------------------------
// Hidden baseline prompt + batched request/response
// ---------------------------------------------------------------------------

// The DEFAULT grounding prompt for the batched instruction request — the Settings page's
// AI summary category lets a user fully replace it (see extension/obsidian/store.js's
// getObsidianSettings(), which falls back to this exact constant when that setting is
// unset/empty, and llm.js's enrichWithLlm(), which sends the resolved setting, not this
// constant directly). Ports the anti-hallucination/timestamp-citation rules from the old
// (now-removed) SYSTEM_PROMPT, generalized to a dynamic per-field JSON schema instead of
// one fixed shape.
export const INTERPRETER_SYSTEM_PROMPT = `You are an assistant that answers a fixed set of instructions about a raw video-call transcript.

Each transcript line is prefixed with an elapsed-time marker — "[M:SS]" for meetings under an hour, "[H:MM:SS]" for meetings an hour or longer — showing how far into the meeting that line was spoken. Whenever an instruction's expected shape includes a "timestamp" field, copy that bracket's value EXACTLY as it appears on the transcript line it came from. Never invent, estimate, or round a timestamp; omit the "timestamp" field entirely rather than guess.

Whenever an instruction's expected shape includes an "assignee" field, name the specific person the transcript clearly assigns that item to. Only fill it in when ownership is stated or obviously implied — omit the "assignee" field entirely rather than guess who it might be.

You will be given a numbered list of instructions, each with an id (e.g. "field_1") and a hint about the expected answer shape: a plain string, a JSON array of short strings, a single object, or a JSON array of objects — object fields may include "text" (always), "timestamp" (optional), and "assignee" (optional), per each instruction's own hint.

Respond with EXACTLY ONE JSON object and nothing else: no prose before or after it, no markdown code fences, no <think> or other reasoning block. The object must have exactly one key per instruction id, holding the answer in the shape hinted for that id.

Rules:
- Base every answer only on the transcript (and chat messages, if present) provided above. Never invent facts, names, or figures not clearly supported by it.
- If an instruction cannot be answered from the transcript, answer with an empty string (or empty array, for array-shaped instructions) rather than invent content.
- Write every answer in the same language the transcript itself is written in, unless the instruction explicitly asks for another language.
- Do not wrap the JSON in a code fence, and do not include any text before or after the JSON object.`

/**
 * The transcript/chat preamble every request needs — moved as-is from llm.js's old
 * buildUserPrompt.
 * @param {Meeting} meeting
 * @returns {string}
 */
function buildTranscriptPreamble(meeting) {
    const title = getMeetingTitle(meeting)
    const software = meeting.meetingSoftware || "Meeting"
    const groups = groupTranscriptBySpeaker(meeting.transcript)

    const transcriptText =
        groups.length > 0
            ? groups
                  .map((g) => {
                      const elapsed = formatElapsedTime(meeting.meetingStartTimestamp, g.timestamp)
                      return elapsed ? `[${elapsed}] ${g.personName}: ${g.text}` : `${g.personName}: ${g.text}`
                  })
                  .join("\n")
            : "(no transcript captured)"

    const chatMessages = meeting.chatMessages || []
    const chatText = chatMessages.length > 0 ? chatMessages.map((m) => `${m.personName}: ${m.chatMessageText}`).join("\n") : ""

    const lines = [
        `Meeting title: ${title}`,
        `Platform: ${software}`,
        "",
        "Each transcript line below is prefixed with [M:SS] or [H:MM:SS], the elapsed time from the start of the meeting.",
        "",
        "Transcript:",
        transcriptText,
    ]

    if (chatText) {
        lines.push("", "Chat messages:", chatText)
    }

    return lines.join("\n")
}

/**
 * @param {CollectedInstruction} instr
 * @returns {string}
 */
function describeShape(instr) {
    const needsObject = instr.timestamped || instr.assigned
    if (needsObject) {
        const fields = ['"text": string']
        if (instr.timestamped) fields.push('"timestamp": string (optional)')
        if (instr.assigned) fields.push('"assignee": string (optional)')
        const objShape = `{${fields.join(", ")}}`
        return instr.listShaped ? `a JSON array of objects ${objShape}` : `a single JSON object ${objShape}`
    }
    if (instr.listShaped) {
        return "a JSON array of short strings"
    }
    return "a plain string"
}

/**
 * @param {Meeting} meeting
 * @param {CollectedInstruction[]} instructions
 * @param {OutputLanguage} [outputLanguage] appends a language directive unless "auto" — kept in the user prompt so it also applies to a customized system prompt
 * @returns {string}
 */
export function buildInterpreterUserPrompt(meeting, instructions, outputLanguage) {
    const preamble = buildTranscriptPreamble(meeting)
    if (!instructions || instructions.length === 0) {
        return preamble
    }
    const lines = [preamble, "", "Instructions — answer each of the following using ONLY the transcript above:"]
    for (const instr of instructions) {
        lines.push(`- ${instr.id} (respond as ${describeShape(instr)}): "${instr.instruction}"`)
    }
    lines.push("", `Respond with one JSON object whose keys are exactly: ${instructions.map((i) => i.id).join(", ")}.`)
    const languageInstruction = outputLanguageInstruction(outputLanguage)
    if (languageInstruction) lines.push(languageInstruction)
    return lines.join("\n")
}

/**
 * @param {unknown} item
 * @param {CollectedInstruction} instr
 * @returns {{text: string, timestamp?: string, assignee?: string} | null}
 */
function coerceStructuredItem(item, instr) {
    if (!item || typeof item !== "object") {
        return null
    }
    const text = typeof (/** @type {any} */ (item).text) === "string" ? /** @type {any} */ (item).text.trim() : ""
    if (!text) {
        return null
    }
    /** @type {{text: string, timestamp?: string, assignee?: string}} */
    const result = { text }
    if (instr.timestamped) {
        const timestamp = /** @type {any} */ (item).timestamp
        result.timestamp = typeof timestamp === "string" ? timestamp : undefined
    }
    if (instr.assigned) {
        const assignee = /** @type {any} */ (item).assignee
        result.assignee = typeof assignee === "string" && assignee.trim() ? assignee.trim() : undefined
    }
    return result
}

/**
 * @param {unknown} raw
 * @param {CollectedInstruction} instr
 * @returns {unknown}
 */
function coerceAnswer(raw, instr) {
    const rawArray = Array.isArray(raw) ? raw : []
    const needsObject = instr.timestamped || instr.assigned
    if (needsObject && instr.listShaped) {
        return rawArray.map((item) => coerceStructuredItem(item, instr)).filter((x) => x !== null)
    }
    if (needsObject) {
        return coerceStructuredItem(raw, instr) || { text: "" }
    }
    if (instr.listShaped) {
        return rawArray.map((x) => (typeof x === "string" ? x : x === null || x === undefined ? "" : String(x))).filter((s) => s !== "")
    }
    return typeof raw === "string" ? raw : raw === null || raw === undefined ? "" : String(raw)
}

/**
 * Build the {instructionText -> coerced answer} map from an already-parsed JSON batch
 * response (see llm.js's extractJsonFromResponse for the tolerant parsing step this
 * expects to run first). Never throws — a missing/malformed field per id degrades to an
 * empty value of the expected shape.
 * @param {Record<string, unknown> | null | undefined} parsedJson
 * @param {CollectedInstruction[]} instructions
 * @returns {Map<string, unknown>}
 */
export function buildInstructionAnswers(parsedJson, instructions) {
    /** @type {Map<string, unknown>} */
    const answers = new Map()
    const source = parsedJson && typeof parsedJson === "object" ? parsedJson : {}
    for (const instr of instructions) {
        answers.set(instr.instruction, coerceAnswer(/** @type {any} */ (source)[instr.id], instr))
    }
    return answers
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** @typedef {{meetingVariables: Record<string, string | string[]>, instructionAnswers: Map<string, unknown>}} ResolutionContext */

/**
 * @param {TemplateSegment} seg
 * @param {ResolutionContext} ctx
 * @returns {string}
 */
function resolveSegment(seg, ctx) {
    if (seg.kind === "literal") {
        return seg.text
    }
    /** @type {unknown} */
    let value
    if (seg.kind === "variable") {
        value = Object.prototype.hasOwnProperty.call(ctx.meetingVariables, seg.name) ? ctx.meetingVariables[seg.name] : ""
    } else {
        const answer = ctx.instructionAnswers.get(seg.instruction.trim())
        value = answer === undefined ? "" : answer
    }
    return applyFilters(value, seg.filters)
}

/**
 * Resolve a template string (typically `noteContent`, or any freeform template) into
 * its final markdown/text — substituting every variable/instruction segment and
 * applying its filters. Never throws.
 * @param {string | undefined | null} templateString
 * @param {ResolutionContext} ctx
 * @returns {string}
 */
export function resolveValue(templateString, ctx) {
    return parseTemplateSegments(templateString)
        .map((seg) => resolveSegment(seg, ctx))
        .join("")
}

/**
 * Resolve a `TemplateProperty.value` template. For `type: "multitext"`, the resolved
 * string is split on commas into an array (mirroring Obsidian's own convention — see
 * the reference template's `"tags": "clippings, facebook"` — a plain comma-separated
 * value becomes a multitext property list; an AI/variable value that itself resolves to
 * a comma-joined string, e.g. {{participants}}, round-trips the same way). Every other
 * type stays a single string.
 * @param {string | undefined | null} templateString
 * @param {ResolutionContext} ctx
 * @param {TemplatePropertyType} type
 * @returns {string | string[]}
 */
export function resolvePropertyValue(templateString, ctx, type) {
    const resolved = resolveValue(templateString, ctx)
    if (type === "multitext") {
        return resolved
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
    }
    return resolved
}
