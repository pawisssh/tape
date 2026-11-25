// @ts-check

// The folder transcript files are saved to. chrome.downloads can only write inside
// Downloads, so a folder the user picks (File System Access) is kept as a directory handle
// in IndexedDB. Picking and re-granting need a user gesture, so they happen on the Settings
// page; the service worker only writes while the permission is still granted.

/** @returns {Promise<IDBDatabase>} */
function openDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("tape-save-folder", 1)
        request.onupgradeneeded = () => request.result.createObjectStore("handles")
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
}

/**
 * @param {IDBTransactionMode} mode
 * @param {(store: IDBObjectStore) => IDBRequest} run
 * @returns {Promise<any>}
 */
async function withStore(mode, run) {
    const db = await openDb()
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction("handles", mode)
            const request = run(tx.objectStore("handles"))
            tx.oncomplete = () => resolve(request.result)
            tx.onerror = () => reject(tx.error)
            tx.onabort = () => reject(tx.error)
        })
    } finally {
        db.close()
    }
}

/** @returns {Promise<any>} the picked FileSystemDirectoryHandle, or undefined for Downloads/Tape */
export function getSaveFolder() {
    return withStore("readonly", (store) => store.get("folder"))
}

/** @param {any} handle @returns {Promise<void>} */
export function setSaveFolder(handle) {
    return withStore("readwrite", (store) => store.put(handle, "folder"))
}

/** @returns {Promise<void>} */
export function clearSaveFolder() {
    return withStore("readwrite", (store) => store.delete("folder"))
}

/**
 * First free name: "name.md", then "name (2).md", "name (3).md"…
 * @param {any} folder FileSystemDirectoryHandle
 * @param {string} filename
 * @returns {Promise<string>}
 */
export async function uniqueName(folder, filename) {
    const dot = filename.lastIndexOf(".")
    const base = filename.slice(0, dot)
    const extension = filename.slice(dot)
    for (let n = 1; ; n++) {
        const name = n === 1 ? filename : `${base} (${n})${extension}`
        try {
            await folder.getFileHandle(name)
        } catch (err) {
            if (/** @type {any} */ (err)?.name === "NotFoundError") return name
            // A directory has that name, so it's taken too.
            if (/** @type {any} */ (err)?.name !== "TypeMismatchError") throw err
        }
    }
}

/**
 * @param {string} filename
 * @param {string} content
 * @returns {Promise<"saved" | "none" | "unavailable">} "none": no folder picked. "unavailable":
 * permission lapsed, or the folder is gone. The caller falls back to Downloads for both.
 */
export async function writeToSaveFolder(filename, content) {
    try {
        const folder = await getSaveFolder()
        if (!folder) return "none"
        if ((await folder.queryPermission({ mode: "readwrite" })) !== "granted") return "unavailable"
        const file = await folder.getFileHandle(await uniqueName(folder, filename), { create: true })
        const writable = await file.createWritable()
        await writable.write(content)
        await writable.close()
        return "saved"
    } catch (err) {
        console.error("Could not write to the chosen save folder:", err)
        return "unavailable"
    }
}
