// @ts-check
/// <reference path="../../types/chrome.d.ts" />
/// <reference path="../../types/index.js" />
/// <reference path="../../types/obsidian.js" />

// User-maintained word -> optional-replacement pairs, grouped into user-defined
// categories, used by applyDictionaryReplacements() (extension/background-script/utils.js)
// to fix commonly mis-transcribed words/names/jargon before a meeting's transcript is
// stored. Stored in chrome.storage.sync, same CRUD-array-per-key shape as templates.js —
// dictionary text isn't a secret, and syncing across the user's own machines is desirable.

const CATEGORIES_KEY = "obsidianDictionaryCategories"
const WORDS_KEY = "obsidianDictionaryWords"

// The built-in category every word without a user-assigned category belongs to. Never
// persisted itself — synthesized at read time by getCategories() — and reserved: it can
// never be renamed (saveCategory) or deleted (deleteCategory).
export const UNCATEGORIZED_ID = "uncategorized"

/** @type {DictionaryCategory} */
const UNCATEGORIZED_CATEGORY = { id: UNCATEGORIZED_ID, name: "Uncategorized", createdAt: "" }

/**
 * @returns {Promise<DictionaryCategory[]>}
 */
export function getCategories() {
    return new Promise((resolve) => {
        chrome.storage.sync.get([CATEGORIES_KEY], function (resultSyncUntyped) {
            const resultSync = /** @type {ResultSync} */ (resultSyncUntyped)
            const categories = resultSync.obsidianDictionaryCategories || []
            resolve([UNCATEGORIZED_CATEGORY, ...categories])
        })
    })
}

/**
 * Insert (no `id`) or update (existing `id`) one category record.
 * @param {Omit<DictionaryCategory, "id" | "createdAt"> & {id?: string, createdAt?: string}} category
 * @returns {Promise<DictionaryCategory>}
 */
export function saveCategory(category) {
    if (category.id === UNCATEGORIZED_ID) {
        return Promise.reject(new Error("Cannot modify the reserved \"uncategorized\" category"))
    }
    return getCategories().then((allCategories) => {
        const categories = allCategories.filter((c) => c.id !== UNCATEGORIZED_ID)
        /** @type {DictionaryCategory} */
        const saved = {
            ...category,
            id: category.id || crypto.randomUUID(),
            createdAt: category.createdAt || new Date().toISOString(),
        }
        const index = categories.findIndex((c) => c.id === saved.id)
        const updated = index === -1 ? [...categories, saved] : categories.map((c, i) => (i === index ? saved : c))
        return new Promise((resolve, reject) => {
            chrome.storage.sync.set({ [CATEGORIES_KEY]: updated }, function () {
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
 * Deletes a category, reassigning any of its words to the "uncategorized" category
 * rather than deleting them. No-op-rejects for the reserved "uncategorized" id itself.
 * @param {string} id
 * @returns {Promise<void>}
 */
export function deleteCategory(id) {
    if (id === UNCATEGORIZED_ID) {
        return Promise.reject(new Error("Cannot delete the reserved \"uncategorized\" category"))
    }
    return getWords().then((words) => {
        const now = new Date().toISOString()
        const reassigned = words.map((w) => (w.categoryId === id ? { ...w, categoryId: UNCATEGORIZED_ID, updatedAt: now } : w))
        return new Promise((resolve, reject) => {
            chrome.storage.sync.set({ [WORDS_KEY]: reassigned }, function () {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError)
                    return
                }
                resolve(undefined)
            })
        })
    }).then(() => getCategories()).then((allCategories) => {
        const updated = allCategories.filter((c) => c.id !== UNCATEGORIZED_ID && c.id !== id)
        return new Promise((resolve, reject) => {
            chrome.storage.sync.set({ [CATEGORIES_KEY]: updated }, function () {
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
 * @returns {Promise<DictionaryEntry[]>}
 */
export function getWords() {
    return new Promise((resolve) => {
        chrome.storage.sync.get([WORDS_KEY], function (resultSyncUntyped) {
            const resultSync = /** @type {ResultSync} */ (resultSyncUntyped)
            resolve(resultSync.obsidianDictionaryWords || [])
        })
    })
}

/**
 * Insert (no `id`) or update (existing `id`) one dictionary entry.
 * @param {Omit<DictionaryEntry, "id" | "createdAt" | "updatedAt"> & {id?: string, createdAt?: string}} word
 * @returns {Promise<DictionaryEntry>}
 */
export function saveWord(word) {
    return getWords().then((words) => {
        const existing = words.find((w) => w.id === word.id)
        /** @type {DictionaryEntry} */
        const saved = {
            ...word,
            id: word.id || crypto.randomUUID(),
            categoryId: word.categoryId || UNCATEGORIZED_ID,
            createdAt: (existing && existing.createdAt) || word.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        }
        const index = words.findIndex((w) => w.id === saved.id)
        const updated = index === -1 ? [...words, saved] : words.map((w, i) => (i === index ? saved : w))
        return new Promise((resolve, reject) => {
            chrome.storage.sync.set({ [WORDS_KEY]: updated }, function () {
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
export function deleteWord(id) {
    return getWords().then((words) => {
        const updated = words.filter((w) => w.id !== id)
        return new Promise((resolve, reject) => {
            chrome.storage.sync.set({ [WORDS_KEY]: updated }, function () {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError)
                    return
                }
                resolve(undefined)
            })
        })
    })
}
