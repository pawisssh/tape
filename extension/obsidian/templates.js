// @ts-check
/// <reference path="../../types/chrome.d.ts" />
/// <reference path="../../types/index.js" />
/// <reference path="../../types/obsidian.js" />

// Summary templates: per-meeting-type Properties/Note-content overrides (see
// SummaryTemplate in types/obsidian.js, resolved by extension/obsidian/interpreter.js),
// auto-selected by matching a comma-separated keyword list against the meeting title
// (see resolveTemplateForTitle below). Stored in chrome.storage.sync — template text
// isn't a secret, unlike provider API keys (see providers.js, which is .local for that
// reason), and syncing templates across the user's own machines is desirable.

const TEMPLATES_KEY = "obsidianLlmSummaryTemplates"

/** @type {TemplatePropertyType[]} */
export const TEMPLATE_PROPERTY_TYPES = ["text", "multitext", "date", "number", "checkbox"]

// The built-in template used whenever no user template matches a meeting (see
// resolveTemplateForTitle below) and as the starting point for a brand-new template in
// the Templates UI (src/meetings/views/TemplatesView.tsx). Reproduces the six summary
// sections the old fixed SYSTEM_PROMPT/renderSummaryMarkdown pipeline used to produce
// (extension/obsidian/llm.js, now removed) through the new interpreter.js engine,
// including per-item timestamp citation via the `timestamped` filter. Never persisted —
// id "default" is reserved and never assigned by saveTemplate (which always generates a
// crypto.randomUUID()).
/** @type {SummaryTemplate} */
export const DEFAULT_TEMPLATE = {
    id: "default",
    name: "Default",
    keywords: "",
    // Every property below matches a baseline field buildFrontmatter() (markdown.js)
    // already produces from the meeting itself, so this is a functional no-op merge —
    // it's written out in full deliberately, as a worked example of every available
    // variable, so opening the Default template teaches the {{variable}} vocabulary
    // instead of hiding six of the seven baseline fields entirely.
    properties: [
        {
            name: "title",
            value: '{{date}}-{{"a concise, engaging title for this meeting in English, under 60 characters, must not contain / : # [ ] |"}}',
            type: "text",
        },
        { name: "date", value: "{{date}}", type: "date" },
        { name: "start", value: "{{meetingStart}}", type: "date" },
        { name: "end", value: "{{meetingEnd}}", type: "date" },
        { name: "duration", value: "{{duration}}", type: "text" },
        { name: "platform", value: "{{platform}}", type: "text" },
        { name: "participants", value: "{{participants}}", type: "multitext" },
    ],
    noteContent: `## Action items

{{"concrete follow-up tasks mentioned in this meeting, phrased as the task itself with no owner or due date, along with who it's assigned to if the transcript clearly states it"|list:"checkbox"|timestamped|assigned}}

## Decisions made

{{"decisions the group explicitly settled on in this meeting"|list|timestamped}}

## Open questions

{{"things left unresolved at the end of this meeting"|list|timestamped}}

## Next steps

{{"the overall plan or sequence going forward after this meeting as a whole, distinct from individual action items"|list|timestamped}}

## Key Takeaways

{{"a short bulleted TL;DR of this meeting: each bullet a bold 2-4 word lead phrase followed by a colon and one sentence of detail, synthesized across the whole meeting"|list}}

## Topics

{{"group the discussion into a few natural themes or agenda items, only if the meeting naturally splits into distinct topics — for each theme, name it inline at the start of the bullet"|list|timestamped}}

## Transcript

{{transcript}}`,
}

/**
 * A template "needs migration" when it predates the Properties/Note-content redesign
 * (it has no `properties` array or `noteContent` string — the old shape was just
 * `{id, name, keywords, systemPrompt}`). Migration seeds the same defaults a brand-new
 * template gets (DEFAULT_TEMPLATE's properties/noteContent, deep-copied) rather than
 * attempting to mechanically translate the old freeform prompt text — the old
 * `systemPrompt` is left on the object, inert, never read again. Applied at read time
 * (inside getTemplates()), not persisted until the user actually saves the template
 * again from the UI.
 * @param {SummaryTemplate} template
 * @returns {SummaryTemplate}
 */
export function migrateLegacyTemplate(template) {
    if (!template) {
        return template
    }
    if (Array.isArray(template.properties) && typeof template.noteContent === "string") {
        return template
    }
    return {
        ...template,
        properties: DEFAULT_TEMPLATE.properties.map((p) => ({ ...p })),
        noteContent: DEFAULT_TEMPLATE.noteContent,
    }
}

/**
 * @returns {Promise<SummaryTemplate[]>}
 */
export function getTemplates() {
    return new Promise((resolve) => {
        chrome.storage.sync.get([TEMPLATES_KEY], function (resultSyncUntyped) {
            const resultSync = /** @type {ResultSync} */ (resultSyncUntyped)
            const templates = resultSync.obsidianLlmSummaryTemplates || []
            resolve(templates.map(migrateLegacyTemplate))
        })
    })
}

/**
 * Insert (no `id`) or update (existing `id`) one template record.
 * @param {Omit<SummaryTemplate, "id"> & {id?: string}} template
 * @returns {Promise<SummaryTemplate>}
 */
export function saveTemplate(template) {
    return getTemplates().then((templates) => {
        /** @type {SummaryTemplate} */
        const saved = { ...template, id: template.id || crypto.randomUUID() }
        const index = templates.findIndex((t) => t.id === saved.id)
        const updated = index === -1 ? [...templates, saved] : templates.map((t, i) => (i === index ? saved : t))
        return new Promise((resolve, reject) => {
            chrome.storage.sync.set({ [TEMPLATES_KEY]: updated }, function () {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError)
                    return
                }
                resolve(saved)
            })
        })
    })
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export function deleteTemplate(id) {
    return getTemplates().then((templates) => {
        const updated = templates.filter((t) => t.id !== id)
        return new Promise((resolve, reject) => {
            chrome.storage.sync.set({ [TEMPLATES_KEY]: updated }, function () {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError)
                    return
                }
                resolve(undefined)
            })
        })
    })
}

/**
 * Picks which template (if any) should drive the summary prompt for a meeting titled
 * `meetingTitle`. Pure — no chrome.* dependency, unit-tested directly in
 * tests/templates.test.mjs. Never throws.
 *
 * A template "matches" when at least one of its comma-separated `keywords` appears
 * (case-insensitive substring) anywhere in `meetingTitle`. The first matching keyworded
 * template wins, in array order. If none match, the first template with an EMPTY
 * `keywords` field (if any) is used as the fallback/default. If nothing at all applies,
 * returns `null` — the caller (enrichWithLlm) then uses the built-in DEFAULT_TEMPLATE.
 * @param {string} meetingTitle
 * @param {SummaryTemplate[]} templates
 * @returns {SummaryTemplate | null}
 */
export function resolveTemplateForTitle(meetingTitle, templates) {
    if (!Array.isArray(templates) || templates.length === 0) {
        return null
    }
    const title = (meetingTitle || "").toLowerCase()

    /** @type {SummaryTemplate | undefined} */
    let fallback
    for (const template of templates) {
        const keywords = (template.keywords || "")
            .split(",")
            .map((k) => k.trim().toLowerCase())
            .filter((k) => k.length > 0)

        if (keywords.length === 0) {
            if (!fallback) fallback = template
            continue
        }
        if (keywords.some((keyword) => title.includes(keyword))) {
            return template
        }
    }
    return fallback || null
}

/**
 * The template that actually governs a meeting whenever nothing more specific applies —
 * the user's own saved override for id "default" if they've ever edited it (see the
 * Templates page's pinned first row, src/meetings/views/TemplatesView.tsx), otherwise the
 * hardcoded DEFAULT_TEMPLATE. Centralizes this lookup so llm.js and TemplatesView.tsx
 * never duplicate it. Pure, never throws.
 * @param {SummaryTemplate[]} templates
 * @returns {SummaryTemplate}
 */
export function resolveDefaultTemplate(templates) {
    const saved = (templates || []).find((t) => t.id === "default")
    return saved ? migrateLegacyTemplate(saved) : DEFAULT_TEMPLATE
}

/**
 * Serialize a template into Obsidian Web Clipper's own template JSON shape (see
 * https://obsidian.md/help/web-clipper/interpreter) — `properties`/`noteContentFormat`
 * map directly onto our `properties`/`noteContent`. `keywords` (a comma-separated
 * substring-match list, not a URL pattern) is the closest analog to Web Clipper's
 * `triggers`, so it round-trips through that field. `noteNameFormat`/`path` have no
 * per-template equivalent here (this app's filename/folder are global settings, not
 * per-template) — pass the current global values in via `options` if you want them
 * included as an informational snapshot; omitted entirely otherwise.
 * @param {SummaryTemplate} template
 * @param {{fileNameTemplate?: string, folder?: string}} [options]
 * @returns {Object}
 */
export function templateToWebClipperJson(template, options) {
    return {
        schemaVersion: "0.1.0",
        name: template.name,
        behavior: "create",
        noteContentFormat: template.noteContent,
        properties: template.properties,
        triggers: (template.keywords || "")
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean),
        noteNameFormat: (options && options.fileNameTemplate) || "",
        path: (options && options.folder) || "",
    }
}

/**
 * The read-side counterpart of templateToWebClipperJson() — also accepts a template
 * previously exported by THIS app (a strict subset of the same shape), so export/import
 * round-trips exactly. Never throws; every field is permissively defaulted so a
 * malformed/partial JSON file still produces a usable (if mostly empty) template rather
 * than an error. Deliberately ignores `schemaVersion`/`behavior`/`noteNameFormat`/`path`
 * — importing a template never mutates this app's global filename/folder settings as a
 * side effect. Does NOT assign an `id` — the caller (TemplatesView's import flow) always
 * treats an imported template as brand new via saveTemplate(), so a colliding id in the
 * JSON (e.g. re-importing your own earlier export) never silently overwrites anything.
 * @param {unknown} json
 * @returns {{name: string, keywords: string, properties: TemplateProperty[], noteContent: string}}
 */
export function templateFromWebClipperJson(json) {
    const obj = json && typeof json === "object" ? /** @type {Record<string, unknown>} */ (json) : {}

    const name = typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : "Imported template"

    const noteContent =
        typeof obj.noteContentFormat === "string"
            ? obj.noteContentFormat
            : typeof obj.noteContent === "string"
              ? obj.noteContent
              : ""

    /** @type {TemplateProperty[]} */
    const properties = Array.isArray(obj.properties)
        ? obj.properties
              .map((p) => {
                  if (!p || typeof p !== "object") return null
                  const name = typeof (/** @type {any} */ (p).name) === "string" ? /** @type {any} */ (p).name : ""
                  if (!name) return null
                  const value = typeof (/** @type {any} */ (p).value) === "string" ? /** @type {any} */ (p).value : ""
                  const type = TEMPLATE_PROPERTY_TYPES.includes(/** @type {any} */ (p).type)
                      ? /** @type {any} */ (p).type
                      : "text"
                  return { name, value, type }
              })
              .filter((p) => p !== null)
        : []

    const keywords = Array.isArray(obj.triggers)
        ? obj.triggers.filter((t) => typeof t === "string").join(", ")
        : ""

    return { name, keywords, properties, noteContent }
}
