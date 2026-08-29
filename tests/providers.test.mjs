import { test, describe, beforeEach } from "node:test"
import assert from "node:assert/strict"

// Same minimal in-memory chrome.storage fake used in store.test.mjs — providers.js only
// ever touches chrome.storage.local.
/** @type {{ local: Record<string, any> }} */
let fakeStorageState

function installFakeChrome() {
    fakeStorageState = { local: {} }

    globalThis.chrome = {
        runtime: { lastError: undefined },
        storage: {
            local: {
                get(keys, callback) {
                    const area = fakeStorageState.local
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
                    Object.assign(fakeStorageState.local, items)
                    queueMicrotask(() => callback && callback())
                },
                remove(keys, callback) {
                    const list = Array.isArray(keys) ? keys : [keys]
                    for (const k of list) delete fakeStorageState.local[k]
                    queueMicrotask(() => callback && callback())
                },
            },
        },
    }
}

installFakeChrome()

const { getProviders, saveProvider, deleteProvider, getActiveModel, setActiveModel, PROVIDER_PRESETS } = await import(
    "../extension/obsidian/providers.js"
)

beforeEach(() => {
    installFakeChrome()
})

describe("PROVIDER_PRESETS", () => {
    test("defines lmstudio and ollama presets", () => {
        assert.equal(PROVIDER_PRESETS.lmstudio.baseUrl, "http://localhost:1234/v1")
        assert.equal(PROVIDER_PRESETS.ollama.baseUrl, "http://localhost:11434/v1")
    })
})

describe("getProviders", () => {
    test("returns an empty array when nothing has been saved", async () => {
        assert.deepEqual(await getProviders(), [])
    })
})

describe("saveProvider", () => {
    test("assigns a stable id on first save and stores the provider", async () => {
        const saved = await saveProvider({ type: "lmstudio", name: "LM Studio", baseUrl: "http://localhost:1234/v1" })
        assert.equal(typeof saved.id, "string")
        assert.ok(saved.id.length > 0)

        const providers = await getProviders()
        assert.equal(providers.length, 1)
        assert.deepEqual(providers[0], saved)
    })

    test("updates an existing provider in place when given its id", async () => {
        const saved = await saveProvider({ type: "custom", name: "My Server", baseUrl: "http://localhost:8000/v1" })
        const updated = await saveProvider({ ...saved, name: "Renamed Server" })

        assert.equal(updated.id, saved.id)
        const providers = await getProviders()
        assert.equal(providers.length, 1)
        assert.equal(providers[0].name, "Renamed Server")
    })

    test("multiple saves accumulate distinct providers", async () => {
        await saveProvider({ type: "lmstudio", name: "LM Studio", baseUrl: "http://localhost:1234/v1" })
        await saveProvider({ type: "custom", name: "OpenAI", baseUrl: "https://api.openai.com/v1", apiKey: "sk-x" })

        const providers = await getProviders()
        assert.equal(providers.length, 2)
    })
})

describe("deleteProvider", () => {
    test("removes the provider from the list", async () => {
        const saved = await saveProvider({ type: "ollama", name: "Ollama", baseUrl: "http://localhost:11434/v1" })
        await deleteProvider(saved.id)
        assert.deepEqual(await getProviders(), [])
    })

    test("leaves other providers untouched", async () => {
        const a = await saveProvider({ type: "lmstudio", name: "A", baseUrl: "http://localhost:1234/v1" })
        const b = await saveProvider({ type: "ollama", name: "B", baseUrl: "http://localhost:11434/v1" })
        await deleteProvider(a.id)

        const providers = await getProviders()
        assert.equal(providers.length, 1)
        assert.equal(providers[0].id, b.id)
    })

    test("clears the active model if it pointed at the deleted provider", async () => {
        const provider = await saveProvider({ type: "lmstudio", name: "LM Studio", baseUrl: "http://localhost:1234/v1" })
        await setActiveModel({ providerId: provider.id, modelId: "llama-3.1" })

        await deleteProvider(provider.id)

        assert.equal(await getActiveModel(), null)
    })

    test("leaves the active model alone if it points at a different provider", async () => {
        const a = await saveProvider({ type: "lmstudio", name: "A", baseUrl: "http://localhost:1234/v1" })
        const b = await saveProvider({ type: "ollama", name: "B", baseUrl: "http://localhost:11434/v1" })
        await setActiveModel({ providerId: b.id, modelId: "llama-3.1" })

        await deleteProvider(a.id)

        assert.deepEqual(await getActiveModel(), { providerId: b.id, modelId: "llama-3.1" })
    })
})

describe("getActiveModel / setActiveModel", () => {
    test("returns null when nothing has been selected", async () => {
        assert.equal(await getActiveModel(), null)
    })

    test("round-trips a selection", async () => {
        await setActiveModel({ providerId: "p1", modelId: "llama-3.1" })
        assert.deepEqual(await getActiveModel(), { providerId: "p1", modelId: "llama-3.1" })
    })

    test("clears the selection when set to null", async () => {
        await setActiveModel({ providerId: "p1", modelId: "llama-3.1" })
        await setActiveModel(null)
        assert.equal(await getActiveModel(), null)
    })
})
