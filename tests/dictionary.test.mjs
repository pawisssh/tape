import { test, describe, beforeEach } from "node:test"
import assert from "node:assert/strict"

// Same minimal in-memory chrome.storage fake used in templates.test.mjs — dictionary.js
// only ever touches chrome.storage.sync (word/category text isn't a secret).
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
    getCategories,
    saveCategory,
    deleteCategory,
    getWords,
    saveWord,
    deleteWord,
    UNCATEGORIZED_ID,
} = await import("../extension/obsidian/dictionary.js")

beforeEach(() => {
    installFakeChrome()
})

describe("getCategories", () => {
    test("always includes the built-in Uncategorized category, even when nothing has been saved", async () => {
        const categories = await getCategories()
        assert.equal(categories.length, 1)
        assert.equal(categories[0].id, UNCATEGORIZED_ID)
        assert.equal(categories[0].name, "Uncategorized")
    })

    test("lists saved categories after Uncategorized", async () => {
        const saved = await saveCategory({ name: "Names" })
        const categories = await getCategories()
        assert.equal(categories.length, 2)
        assert.equal(categories[0].id, UNCATEGORIZED_ID)
        assert.deepEqual(categories[1], saved)
    })
})

describe("saveCategory", () => {
    test("assigns a stable id on first save and stores the category", async () => {
        const saved = await saveCategory({ name: "Jargon" })
        assert.equal(typeof saved.id, "string")
        assert.ok(saved.id.length > 0)
        assert.notEqual(saved.id, UNCATEGORIZED_ID)
    })

    test("updates an existing category in place when given its id", async () => {
        const saved = await saveCategory({ name: "Jargon" })
        const renamed = await saveCategory({ ...saved, name: "Tech jargon" })

        assert.equal(renamed.id, saved.id)
        const categories = await getCategories()
        assert.equal(categories.length, 2)
        assert.equal(categories[1].name, "Tech jargon")
    })

    test("refuses to write the reserved id \"uncategorized\"", async () => {
        await assert.rejects(() => saveCategory({ id: UNCATEGORIZED_ID, name: "Renamed" }))
        const categories = await getCategories()
        assert.equal(categories.length, 1)
        assert.equal(categories[0].name, "Uncategorized")
    })
})

describe("deleteCategory", () => {
    test("removes the category from the list", async () => {
        const saved = await saveCategory({ name: "Jargon" })
        await deleteCategory(saved.id)
        assert.equal((await getCategories()).length, 1)
    })

    test("reassigns its words to Uncategorized rather than deleting them", async () => {
        const category = await saveCategory({ name: "Jargon" })
        const word = await saveWord({ word: "kubernetes", categoryId: category.id })

        await deleteCategory(category.id)

        const words = await getWords()
        assert.equal(words.length, 1)
        assert.equal(words[0].id, word.id)
        assert.equal(words[0].categoryId, UNCATEGORIZED_ID)
    })

    test("refuses to delete the reserved \"uncategorized\" category", async () => {
        await assert.rejects(() => deleteCategory(UNCATEGORIZED_ID))
        assert.equal((await getCategories())[0].id, UNCATEGORIZED_ID)
    })
})

describe("getWords", () => {
    test("returns an empty array when nothing has been saved", async () => {
        assert.deepEqual(await getWords(), [])
    })
})

describe("saveWord", () => {
    test("assigns a stable id and defaults categoryId to Uncategorized when omitted", async () => {
        const saved = await saveWord({ word: "kubernetes" })
        assert.equal(typeof saved.id, "string")
        assert.equal(saved.categoryId, UNCATEGORIZED_ID)
    })

    test("preserves an omitted replacement as absent, not coerced to an empty string", async () => {
        const saved = await saveWord({ word: "kubernetes" })
        assert.equal("replacement" in saved, false)
    })

    test("stores an optional replacement", async () => {
        const saved = await saveWord({ word: "k8s", replacement: "kubernetes" })
        assert.equal(saved.replacement, "kubernetes")
    })

    test("updates an existing word in place when given its id", async () => {
        const saved = await saveWord({ word: "k8s", replacement: "kubernetes" })
        const updated = await saveWord({ ...saved, replacement: "Kubernetes" })

        assert.equal(updated.id, saved.id)
        const words = await getWords()
        assert.equal(words.length, 1)
        assert.equal(words[0].replacement, "Kubernetes")
    })

    test("sets createdAt on insert and refreshes updatedAt on every save", async () => {
        const saved = await saveWord({ word: "k8s" })
        assert.equal(typeof saved.createdAt, "string")
        assert.equal(typeof saved.updatedAt, "string")

        const updated = await saveWord({ ...saved, word: "K8s" })
        assert.equal(updated.createdAt, saved.createdAt)
    })
})

describe("deleteWord", () => {
    test("removes only the given word", async () => {
        const a = await saveWord({ word: "a" })
        const b = await saveWord({ word: "b" })
        await deleteWord(a.id)

        const words = await getWords()
        assert.equal(words.length, 1)
        assert.equal(words[0].id, b.id)
    })
})
