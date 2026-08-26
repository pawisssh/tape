// Thin promisified wrapper around chrome.runtime.sendMessage, typed against the shared
// ExtensionMessage/ExtensionResponse ambient types (types/index.js). No business logic —
// the background script (extension/background-script/index.js) owns all message
// handling; see PLAN.md §6 Phase 5.

export function sendMessage(message: ExtensionMessage): Promise<ExtensionResponse> {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage(message, (response: ExtensionResponse) => {
            resolve(response)
        })
    })
}

/**
 * `ExtensionResponse["message"]` is `string | string[] | ErrorObject` — narrow it down to
 * just the ErrorObject case (a plain `typeof x === "object"` check also matches the
 * `string[]` branch, since arrays are `typeof "object"` in JS too).
 */
export function asErrorObject(message: ExtensionResponse["message"]): ErrorObject | undefined {
    return message && typeof message === "object" && !Array.isArray(message) ? message : undefined
}
