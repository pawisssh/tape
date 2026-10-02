// @ts-check
import { cleanText, isRecord } from "./shared.js"

export const RECAP_SKILL_REVISION = 1

/** @typedef {{task: string, owner?: string, deadline?: string}} RecapAction */
/** @typedef {{overview: string, decisions: string[], actionItems: RecapAction[], unresolvedQuestions: string[]}} RecapState */
/** @typedef {{kind: "decision" | "actionItem" | "unresolvedQuestion", text: string, evidence: string}} Supersession */

/** @returns {RecapState} */
export function emptyRecapState() {
    return { overview: "", decisions: [], actionItems: [], unresolvedQuestions: [] }
}

/** @param {unknown} value @returns {RecapState | null} */
export function validateRecapState(value) {
    if (!isRecord(value) || typeof value.overview !== "string" ||
        !Array.isArray(value.decisions) || !Array.isArray(value.actionItems) ||
        !Array.isArray(value.unresolvedQuestions)) return null
    if (![...value.decisions, ...value.unresolvedQuestions].every(item => typeof item === "string" && !!item.trim())) return null
    if (!value.actionItems.every(item => isRecord(item) && !!cleanText(item.task) &&
        (item.owner === undefined || typeof item.owner === "string") &&
        (item.deadline === undefined || typeof item.deadline === "string"))) return null
    return {
        overview: value.overview.trim(),
        decisions: value.decisions.map(item => item.trim()),
        actionItems: value.actionItems.map(item => ({
            task: cleanText(item.task),
            ...(cleanText(item.owner) ? { owner: cleanText(item.owner) } : {}),
            ...(cleanText(item.deadline) ? { deadline: cleanText(item.deadline) } : {}),
        })),
        unresolvedQuestions: value.unresolvedQuestions.map(item => item.trim()),
    }
}

/** @param {unknown} value @returns {{state: RecapState, superseded: Supersession[]} | null} */
export function validateRecapOutput(value) {
    if (!isRecord(value)) return null
    const state = validateRecapState(value)
    if (!state || !Array.isArray(value.superseded)) return null
    if (!value.superseded.every(item => isRecord(item) &&
        ["decision", "actionItem", "unresolvedQuestion"].includes(item.kind) &&
        !!cleanText(item.text) && cleanText(item.evidence).length >= 8)) return null
    return { state, superseded: value.superseded.map(item => ({
        kind: item.kind, text: cleanText(item.text), evidence: cleanText(item.evidence),
    })) }
}

/** @param {string} value */
const key = value => value.trim().replace(/\s+/g, " ").toLocaleLowerCase()

/** @param {string[]} earlier @param {string[]} incoming @param {Set<string>} removed */
function mergeTexts(earlier, incoming, removed) {
    const seen = new Set()
    return [...earlier, ...incoming].filter(item => {
        const normalized = key(item)
        if (removed.has(normalized) || seen.has(normalized)) return false
        seen.add(normalized)
        return true
    })
}

/** @param {RecapState} previous @param {{state: RecapState, superseded: Supersession[]}} output @param {string} excerpt @returns {RecapState} */
export function mergeRecapState(previous, output, excerpt) {
    const removed = { decision: new Set(), actionItem: new Set(), unresolvedQuestion: new Set() }
    for (const item of output.superseded) {
        if (excerpt.includes(item.evidence)) removed[item.kind].add(key(item.text))
    }
    const actions = new Map()
    for (const action of previous.actionItems) {
        const normalized = key(action.task)
        if (removed.actionItem.has(normalized)) continue
        actions.set(normalized, action)
    }
    for (const action of output.state.actionItems) {
        const normalized = key(action.task)
        const existing = actions.get(normalized)
        actions.set(normalized, existing
            ? { task: existing.task, owner: action.owner || existing.owner, deadline: action.deadline || existing.deadline }
            : action)
    }
    return {
        overview: output.state.overview || previous.overview,
        decisions: mergeTexts(previous.decisions, output.state.decisions, removed.decision),
        actionItems: [...actions.values()],
        unresolvedQuestions: mergeTexts(previous.unresolvedQuestions, output.state.unresolvedQuestions, removed.unresolvedQuestion),
    }
}

/** @param {RecapState} state */
export function renderRecap(state) {
    const sections = [state.overview.slice(0, 1200)]
    if (state.decisions.length) sections.push("Decisions\n" + state.decisions.map(item => "• " + item).join("\n"))
    if (state.actionItems.length) sections.push("Action items\n" + state.actionItems.map(item =>
        "• " + item.task + (item.owner ? " — " + item.owner : "") + (item.deadline ? " (" + item.deadline + ")" : "")).join("\n"))
    if (state.unresolvedQuestions.length) sections.push("Unresolved questions\n" + state.unresolvedQuestions.map(item => "• " + item).join("\n"))
    return sections.filter(Boolean).join("\n\n")
}

export const recapSkill = {
    id: "recap",
    /** @param {RecapState} previous @param {string} excerpt */
    buildPrompt(previous, excerpt) {
        return JSON.stringify({
            task: "Update the meeting recap from the new transcript. Return a concise overview and newly supported decisions, action items and unresolved questions. Retain previous supported facts. If new evidence explicitly corrects an earlier item, include its exact prior text in superseded with a verbatim evidence quote from newTranscript. Do not imply the meeting ended.",
            outputShape: { overview: "string", decisions: ["string"], actionItems: [{ task: "string", owner: "optional explicit string", deadline: "optional explicit string" }], unresolvedQuestions: ["string"], superseded: [{ kind: "decision | actionItem | unresolvedQuestion", text: "exact prior item text", evidence: "verbatim quote from newTranscript" }] },
            previousState: previous,
            newTranscript: excerpt,
        })
    },
    validate: validateRecapOutput,
    render: renderRecap,
}
