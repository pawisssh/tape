import { test, describe, beforeEach } from "node:test"
import assert from "node:assert/strict"

// Same minimal in-memory chrome.storage fake used in providers.test.mjs — templates.js
// only ever touches chrome.storage.sync (unlike providers.js, which is .local since it
// holds API keys).
/** @type {{ sync: Record<string, any> }} */
let fakeStorageState

function installFakeChrome() {
    fakeStorageState = { sync: {} }

    globalThis.chrome = {
        runtime: { lastError: undefined },
        storage: {
            sync: {
                get(keys, callback) {
                    const area = fakeStorageState.sync
                    let result = {}
                    if (keys === null || keys === undefined) {
                        result = { ...area }
                    } else if (Array.isArray(keys)) {
                        for (const k of keys) result[k] = area[k]
                    } else if (typeof keys === "string") {
                        result[keys] = area[keys]
                    }
                    queueMicrotask(() => callback(result))
                },
                set(items, callback) {
                    Object.assign(fakeStorageState.sync, items)
                    queueMicrotask(() => callback && callback())
                },
            },
        },
    }
}

installFakeChrome()

const {
    getTemplates,
    saveTemplate,
    deleteTemplate,
    resolveTemplateForTitle,
    resolveDefaultTemplate,
    migrateLegacyTemplate,
    DEFAULT_TEMPLATE,
    templateToWebClipperJson,
    templateFromWebClipperJson,
} = await import("../extension/obsidian/templates.js")

beforeEach(() => {
    installFakeChrome()
})

describe("getTemplates", () => {
    test("returns an empty array when nothing has been saved", async () => {
        assert.deepEqual(await getTemplates(), [])
    })
})

describe("saveTemplate", () => {
    test("assigns a stable id on first save and stores the template", async () => {
        const saved = await saveTemplate({ name: "Standup", keywords: "standup, daily sync", systemPrompt: "..." })
        assert.equal(typeof saved.id, "string")
        assert.ok(saved.id.length > 0)

        const templates = await getTemplates()
        assert.equal(templates.length, 1)
        // getTemplates() migrates legacy (systemPrompt-only) templates at read time —
        // see the migrateLegacyTemplate describe block below — so the read-back copy
        // gains properties/noteContent that the raw saveTemplate() return value doesn't.
        assert.deepEqual(templates[0], migrateLegacyTemplate(saved))
    })

    test("updates an existing template in place when given its id", async () => {
        const saved = await saveTemplate({ name: "Standup", keywords: "standup", systemPrompt: "a" })
        const updated = await saveTemplate({ ...saved, systemPrompt: "b" })

        assert.equal(updated.id, saved.id)
        const templates = await getTemplates()
        assert.equal(templates.length, 1)
        assert.equal(templates[0].systemPrompt, "b")
    })

    test("multiple saves accumulate distinct templates", async () => {
        await saveTemplate({ name: "Standup", keywords: "standup", systemPrompt: "a" })
        await saveTemplate({ name: "Sales call", keywords: "sales, demo", systemPrompt: "b" })

        assert.equal((await getTemplates()).length, 2)
    })
})

describe("deleteTemplate", () => {
    test("removes the template from the list", async () => {
        const saved = await saveTemplate({ name: "Standup", keywords: "standup", systemPrompt: "a" })
        await deleteTemplate(saved.id)
        assert.deepEqual(await getTemplates(), [])
    })

    test("leaves other templates untouched", async () => {
        const a = await saveTemplate({ name: "A", keywords: "a", systemPrompt: "a" })
        const b = await saveTemplate({ name: "B", keywords: "b", systemPrompt: "b" })
        await deleteTemplate(a.id)

        const templates = await getTemplates()
        assert.equal(templates.length, 1)
        assert.equal(templates[0].id, b.id)
    })
})

describe("resolveTemplateForTitle", () => {
    test("returns null when there are no templates at all", () => {
        assert.equal(resolveTemplateForTitle("Daily Standup", []), null)
    })

    test("matches a keyworded template via case-insensitive substring", () => {
        const standup = { id: "1", name: "Standup", keywords: "standup, daily sync", systemPrompt: "a" }
        assert.deepEqual(resolveTemplateForTitle("Daily STANDUP", [standup]), standup)
    })

    test("matches on any one of several comma-separated keywords", () => {
        const template = { id: "1", name: "Sales", keywords: "sales, demo, discovery call", systemPrompt: "a" }
        assert.deepEqual(resolveTemplateForTitle("Q3 Discovery Call with Acme", [template]), template)
    })

    test("first matching keyworded template wins, in array order", () => {
        const first = { id: "1", name: "First", keywords: "standup", systemPrompt: "a" }
        const second = { id: "2", name: "Second", keywords: "standup", systemPrompt: "b" }
        assert.deepEqual(resolveTemplateForTitle("Daily Standup", [first, second]), first)
    })

    test("falls back to the first keyword-less template when nothing matches", () => {
        const standup = { id: "1", name: "Standup", keywords: "standup", systemPrompt: "a" }
        const fallback = { id: "2", name: "Default", keywords: "", systemPrompt: "b" }
        assert.deepEqual(resolveTemplateForTitle("1:1 with manager", [standup, fallback]), fallback)
    })

    test("a keyworded match still wins over a keyword-less fallback", () => {
        const standup = { id: "1", name: "Standup", keywords: "standup", systemPrompt: "a" }
        const fallback = { id: "2", name: "Default", keywords: "", systemPrompt: "b" }
        assert.deepEqual(resolveTemplateForTitle("Daily Standup", [fallback, standup]), standup)
    })

    test("returns null when nothing matches and there is no keyword-less template", () => {
        const standup = { id: "1", name: "Standup", keywords: "standup", systemPrompt: "a" }
        assert.equal(resolveTemplateForTitle("1:1 with manager", [standup]), null)
    })

    test("a template with only whitespace/empty keyword entries counts as keyword-less", () => {
        const fallback = { id: "1", name: "Default", keywords: " , ,", systemPrompt: "a" }
        assert.deepEqual(resolveTemplateForTitle("Anything", [fallback]), fallback)
    })

    test("never throws on a missing/empty meeting title", () => {
        const fallback = { id: "1", name: "Default", keywords: "", systemPrompt: "a" }
        assert.deepEqual(resolveTemplateForTitle("", [fallback]), fallback)
        assert.deepEqual(resolveTemplateForTitle(/** @type {any} */ (undefined), [fallback]), fallback)
    })
})

describe("DEFAULT_TEMPLATE", () => {
    test("has the reserved id 'default' and is never assigned by saveTemplate", async () => {
        assert.equal(DEFAULT_TEMPLATE.id, "default")
        const saved = await saveTemplate({ name: "X", keywords: "", systemPrompt: "" })
        assert.notEqual(saved.id, "default")
    })

    test("has properties/noteContent already in the new shape", () => {
        assert.ok(Array.isArray(DEFAULT_TEMPLATE.properties))
        assert.equal(typeof DEFAULT_TEMPLATE.noteContent, "string")
        assert.ok(DEFAULT_TEMPLATE.noteContent.length > 0)
    })

    test("its properties are a worked example covering title plus every baseline frontmatter field", () => {
        const names = DEFAULT_TEMPLATE.properties.map((p) => p.name)
        assert.deepEqual(names, ["title", "date", "start", "end", "duration", "platform", "participants"])
        assert.equal(DEFAULT_TEMPLATE.properties[0].type, "text")
        assert.ok(DEFAULT_TEMPLATE.properties[0].value.includes('"'), "title should still be (partly) an AI instruction")
    })

    test("noteContent ends with a Transcript section using {{transcript}}", () => {
        assert.match(DEFAULT_TEMPLATE.noteContent, /## Transcript\n\n\{\{transcript\}\}$/)
    })
})

describe("resolveDefaultTemplate", () => {
    test("returns the hardcoded DEFAULT_TEMPLATE when no id-\"default\" entry exists", () => {
        assert.equal(resolveDefaultTemplate([]), DEFAULT_TEMPLATE)
        assert.equal(resolveDefaultTemplate([{ id: "1", name: "Standup", keywords: "standup", properties: [], noteContent: "" }]), DEFAULT_TEMPLATE)
    })

    test("returns the user's saved override for id \"default\" when present, not the hardcoded constant", () => {
        const customized = { id: "default", name: "Default", keywords: "", properties: [], noteContent: "custom note content" }
        const resolved = resolveDefaultTemplate([{ id: "1", name: "Standup", keywords: "standup", properties: [], noteContent: "" }, customized])
        assert.equal(resolved.noteContent, "custom note content")
        assert.notEqual(resolved, DEFAULT_TEMPLATE)
    })

    test("migrates a legacy-shaped saved \"default\" entry rather than returning it as-is", () => {
        const legacyDefault = { id: "default", name: "Default", keywords: "", systemPrompt: "old raw prompt text" }
        const resolved = resolveDefaultTemplate([legacyDefault])
        assert.deepEqual(resolved.properties, DEFAULT_TEMPLATE.properties)
        assert.equal(resolved.noteContent, DEFAULT_TEMPLATE.noteContent)
    })

    test("never throws on a missing/non-array input", () => {
        assert.equal(resolveDefaultTemplate(/** @type {any} */ (undefined)), DEFAULT_TEMPLATE)
        assert.equal(resolveDefaultTemplate(/** @type {any} */ (null)), DEFAULT_TEMPLATE)
    })
})

describe("migrateLegacyTemplate", () => {
    test("leaves an already-migrated (new-shape) template untouched", () => {
        const template = { id: "1", name: "X", keywords: "", properties: [{ name: "a", value: "b", type: "text" }], noteContent: "hi" }
        assert.deepEqual(migrateLegacyTemplate(template), template)
    })

    test("seeds DEFAULT_TEMPLATE's properties/noteContent onto a legacy (systemPrompt-only) template", () => {
        const legacy = { id: "1", name: "X", keywords: "standup", systemPrompt: "old raw prompt text" }
        const migrated = migrateLegacyTemplate(legacy)
        assert.deepEqual(migrated.properties, DEFAULT_TEMPLATE.properties)
        assert.equal(migrated.noteContent, DEFAULT_TEMPLATE.noteContent)
    })

    test("preserves id/name/keywords and leaves the old systemPrompt text inertly on the object", () => {
        const legacy = { id: "1", name: "X", keywords: "standup", systemPrompt: "old raw prompt text" }
        const migrated = migrateLegacyTemplate(legacy)
        assert.equal(migrated.id, "1")
        assert.equal(migrated.name, "X")
        assert.equal(migrated.keywords, "standup")
        assert.equal(migrated.systemPrompt, "old raw prompt text")
    })

    test("migrating twice is idempotent", () => {
        const legacy = { id: "1", name: "X", keywords: "", systemPrompt: "old" }
        const once = migrateLegacyTemplate(legacy)
        const twice = migrateLegacyTemplate(once)
        assert.deepEqual(once, twice)
    })

    test("returns falsy input unchanged rather than throwing", () => {
        assert.equal(migrateLegacyTemplate(/** @type {any} */ (null)), null)
        assert.equal(migrateLegacyTemplate(/** @type {any} */ (undefined)), undefined)
    })

    test("getTemplates() migrates every stored legacy template", async () => {
        await saveTemplate({ name: "Legacy", keywords: "x", systemPrompt: "old" })
        const templates = await getTemplates()
        assert.equal(templates.length, 1)
        assert.deepEqual(templates[0].properties, DEFAULT_TEMPLATE.properties)
        assert.equal(templates[0].noteContent, DEFAULT_TEMPLATE.noteContent)
    })
})

describe("templateToWebClipperJson", () => {
    const template = {
        id: "1",
        name: "Standup",
        keywords: "standup, daily sync",
        properties: [{ name: "title", value: "{{title}}", type: "text" }],
        noteContent: "# {{title}}",
    }

    test("maps our fields onto Web Clipper's schema", () => {
        const json = templateToWebClipperJson(template)
        assert.equal(json.schemaVersion, "0.1.0")
        assert.equal(json.name, "Standup")
        assert.equal(json.behavior, "create")
        assert.equal(json.noteContentFormat, "# {{title}}")
        assert.deepEqual(json.properties, template.properties)
    })

    test("keywords becomes a trimmed triggers array", () => {
        const json = templateToWebClipperJson(template)
        assert.deepEqual(json.triggers, ["standup", "daily sync"])
    })

    test("empty keywords becomes an empty triggers array", () => {
        const json = templateToWebClipperJson({ ...template, keywords: "" })
        assert.deepEqual(json.triggers, [])
    })

    test("noteNameFormat/path default to empty strings, or reflect the passed-in global settings", () => {
        assert.equal(templateToWebClipperJson(template).noteNameFormat, "")
        assert.equal(templateToWebClipperJson(template).path, "")
        const withOptions = templateToWebClipperJson(template, { fileNameTemplate: "{{date}}", folder: "Meetings" })
        assert.equal(withOptions.noteNameFormat, "{{date}}")
        assert.equal(withOptions.path, "Meetings")
    })
})

describe("templateFromWebClipperJson", () => {
    test("round-trips a template exported by this app", () => {
        const template = {
            id: "1",
            name: "Standup",
            keywords: "standup, daily sync",
            properties: [{ name: "title", value: "{{title}}", type: "text" }],
            noteContent: "# {{title}}",
        }
        const roundTripped = templateFromWebClipperJson(templateToWebClipperJson(template))
        assert.equal(roundTripped.name, "Standup")
        assert.equal(roundTripped.keywords, "standup, daily sync")
        assert.deepEqual(roundTripped.properties, template.properties)
        assert.equal(roundTripped.noteContent, "# {{title}}")
    })

    test("a real Obsidian Web Clipper export (no properties/triggers/behavior we recognize) still imports", () => {
        const webClipperJson = {
            schemaVersion: "0.1.0",
            name: "Facebook",
            behavior: "create",
            noteContentFormat: "# {{title}}\n\n## TL;DR\n",
            properties: [{ name: "source", value: "{{url}}", type: "text" }],
            triggers: ["https://www.facebook.com/"],
            noteNameFormat: "{{date}}",
            path: "Notes/Clippings",
        }
        const template = templateFromWebClipperJson(webClipperJson)
        assert.equal(template.name, "Facebook")
        assert.equal(template.keywords, "https://www.facebook.com/")
        assert.deepEqual(template.properties, [{ name: "source", value: "{{url}}", type: "text" }])
        assert.equal(template.noteContent, "# {{title}}\n\n## TL;DR\n")
    })

    test("a property with an invalid/missing type defaults to text", () => {
        const template = templateFromWebClipperJson({ properties: [{ name: "x", value: "y" }] })
        assert.equal(template.properties[0].type, "text")
    })

    test("a property missing a name is dropped", () => {
        const template = templateFromWebClipperJson({ properties: [{ value: "y", type: "text" }, { name: "ok", value: "z", type: "text" }] })
        assert.equal(template.properties.length, 1)
        assert.equal(template.properties[0].name, "ok")
    })

    test("never throws on malformed/missing fields, permissive defaults throughout", () => {
        assert.doesNotThrow(() => templateFromWebClipperJson(null))
        assert.doesNotThrow(() => templateFromWebClipperJson(undefined))
        assert.doesNotThrow(() => templateFromWebClipperJson("not an object"))
        assert.doesNotThrow(() => templateFromWebClipperJson(42))
        assert.doesNotThrow(() => templateFromWebClipperJson({}))

        const empty = templateFromWebClipperJson({})
        assert.equal(empty.name, "Imported template")
        assert.equal(empty.keywords, "")
        assert.deepEqual(empty.properties, [])
        assert.equal(empty.noteContent, "")
    })

    test("never assigns an id — importing is always a brand-new template", () => {
        const template = templateFromWebClipperJson({ name: "X" })
        assert.equal("id" in template, false)
    })

    test("ignores schemaVersion/behavior/noteNameFormat/path — no side effects on global settings", () => {
        const template = templateFromWebClipperJson({
            name: "X",
            schemaVersion: "9.9.9",
            behavior: "append",
            noteNameFormat: "should not leak anywhere",
            path: "should not leak anywhere",
        })
        assert.deepEqual(Object.keys(template).sort(), ["keywords", "name", "noteContent", "properties"])
    })
})
