// @ts-check
/// <reference path="../../types/chrome.d.ts" />
/// <reference path="../../types/index.js" />
/// <reference path="../../types/obsidian.js" />

// Multi-provider LLM connector storage. Deliberately in chrome.storage.local, not .sync —
// this is the one place an API key (a secret) gets persisted, and syncing that through the
// user's Google account is the wrong default. See ObsidianSettings.obsidianLlmApiKey in
// types/obsidian.js for how store.js resolves a provider + active model into the flat
// endpoint/model/apiKey shape enrichWithLlm() actually consumes.

const PROVIDERS_KEY = "obsidianLlmProviders"
const ACTIVE_MODEL_KEY = "obsidianLlmActiveModel"

/** @type {Record<Exclude<ObsidianLlmProviderType, "custom">, {name: string, baseUrl: string}>} */
export const PROVIDER_PRESETS = {
    lmstudio: { name: "LM Studio", baseUrl: "http://localhost:1234/v1" },
    ollama: { name: "Ollama", baseUrl: "http://localhost:11434/v1" },
}

/**
 * @returns {Promise<LlmProviderConfig[]>}
 */
export function getProviders() {
    return new Promise((resolve) => {
        chrome.storage.local.get([PROVIDERS_KEY], function (resultLocalUntyped) {
            const resultLocal = /** @type {ResultLocal} */ (resultLocalUntyped)
            resolve(resultLocal.obsidianLlmProviders || [])
        })
    })
}

/**
 * Insert (no `id`) or update (existing `id`) one provider record.
 * @param {Omit<LlmProviderConfig, "id"> & {id?: string}} provider
 * @returns {Promise<LlmProviderConfig>}
 */
export function saveProvider(provider) {
    return getProviders().then((providers) => {
        /** @type {LlmProviderConfig} */
        const saved = { ...provider, id: provider.id || crypto.randomUUID() }
        const index = providers.findIndex((p) => p.id === saved.id)
        const updated = index === -1 ? [...providers, saved] : providers.map((p, i) => (i === index ? saved : p))
        return new Promise((resolve, reject) => {
            chrome.storage.local.set({ [PROVIDERS_KEY]: updated }, function () {
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
 * Deletes a provider, and clears the active-model selection if it pointed at this
 * provider (there is nothing left to resolve it to).
 * @param {string} id
 * @returns {Promise<void>}
 */
export function deleteProvider(id) {
    return Promise.all([getProviders(), getActiveModel()]).then(([providers, activeModel]) => {
        const updated = providers.filter((p) => p.id !== id)
        /** @type {Record<string, unknown>} */
        const toSet = { [PROVIDERS_KEY]: updated }
        /** @type {string[]} */
        const toRemove = []
        if (activeModel && activeModel.providerId === id) {
            toRemove.push(ACTIVE_MODEL_KEY)
        }
        return new Promise((resolve, reject) => {
            chrome.storage.local.set(toSet, function () {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError)
                    return
                }
                if (toRemove.length === 0) {
                    resolve(undefined)
                    return
                }
                chrome.storage.local.remove(toRemove, function () {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError)
                        return
                    }
                    resolve(undefined)
                })
            })
        })
    })
}

/**
 * @returns {Promise<ObsidianLlmActiveModel | null>}
 */
export function getActiveModel() {
    return new Promise((resolve) => {
        chrome.storage.local.get([ACTIVE_MODEL_KEY], function (resultLocalUntyped) {
            const resultLocal = /** @type {ResultLocal} */ (resultLocalUntyped)
            resolve(resultLocal.obsidianLlmActiveModel || null)
        })
    })
}

/**
 * @param {ObsidianLlmActiveModel | null} selection
 * @returns {Promise<void>}
 */
export function setActiveModel(selection) {
    return new Promise((resolve, reject) => {
        if (!selection) {
            chrome.storage.local.remove([ACTIVE_MODEL_KEY], function () {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError)
                    return
                }
                resolve(undefined)
            })
            return
        }
        chrome.storage.local.set({ [ACTIVE_MODEL_KEY]: selection }, function () {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError)
                return
            }
            resolve(undefined)
        })
    })
}
