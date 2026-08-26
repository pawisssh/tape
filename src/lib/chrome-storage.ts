// Thin React-side wrappers around chrome.storage's callback API, promisified for use in
// hooks/effects. All actual business logic (read-modify-write semantics, defaults,
// clipboard locking, etc.) stays in extension/obsidian/store.js and the background
// script — this file adds no behavior of its own beyond promise/subscription plumbing.
// See PLAN.md §6 Phase 5: "New src/lib/{chrome-storage.ts,messaging.ts,permissions.ts,
// utils.ts} hold thin React-side wrappers only."

/**
 * @param keys pass `null` to fetch the entire storage area
 */
export function getSync<T extends Record<string, unknown>>(keys: string[] | null): Promise<T> {
    return new Promise((resolve) => {
        chrome.storage.sync.get(keys, (result) => resolve(result as T))
    })
}

export function setSync(items: Record<string, unknown>): Promise<void> {
    return new Promise((resolve, reject) => {
        chrome.storage.sync.set(items, () => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError)
                return
            }
            resolve()
        })
    })
}

/**
 * @param keys pass `null` to fetch the entire storage area
 */
export function getLocal<T extends Record<string, unknown>>(keys: string[] | null): Promise<T> {
    return new Promise((resolve) => {
        chrome.storage.local.get(keys, (result) => resolve(result as T))
    })
}

export function setLocal(items: Record<string, unknown>): Promise<void> {
    return new Promise((resolve, reject) => {
        chrome.storage.local.set(items, () => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError)
                return
            }
            resolve()
        })
    })
}

export function removeLocal(keys: string | string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        chrome.storage.local.remove(keys, () => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError)
                return
            }
            resolve()
        })
    })
}

/**
 * Subscribe to chrome.storage.onChanged. Returns an unsubscribe function, so this drops
 * neatly into a React `useEffect` cleanup.
 */
export function onStorageChanged(
    callback: (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void,
): () => void {
    chrome.storage.onChanged.addListener(callback)
    return () => chrome.storage.onChanged.removeListener(callback)
}
