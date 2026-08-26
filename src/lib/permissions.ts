// Thin React-side wrappers around chrome.permissions, for the LLM-endpoint and webhook
// permission-gesture flows on the meetings page (Phase 4/5). The origin-pattern
// derivation itself is NOT duplicated here for the LLM endpoint — it's imported from
// extension/obsidian/llm.js's endpointOriginPattern(), the single source of truth also
// used by the background script and tests/llm.test.mjs.

// @ts-check-free import: llm.js is a plain, framework-free ESM module (see PLAN.md §6
// Phase 5 "Structural rule to preserve") — imported directly, never duplicated.
import { endpointOriginPattern } from "../../extension/obsidian/llm.js"

export { endpointOriginPattern }

/**
 * Derive a `*://host/*` origin match pattern from an arbitrary URL (used for the webhook
 * URL field, mirroring the pattern already used for the LLM endpoint and for upstream's
 * own webhook permission request in the pre-Phase-5 extension/meetings.js).
 */
export function webhookOriginPattern(url: string): string | null {
    try {
        const parsed = new URL(url)
        return `${parsed.protocol}//${parsed.hostname}/*`
    } catch {
        return null
    }
}

/**
 * Must be called synchronously from within a genuine user gesture handler (e.g. a
 * checkbox's onChange) — Chrome refuses chrome.permissions.request() calls made outside
 * one.
 */
export function requestPermissions(
    origins: string[],
    permissions: chrome.runtime.ManifestPermissions[] = [],
): Promise<boolean> {
    return chrome.permissions.request({ origins, permissions })
}

export function hasPermissions(
    origins: string[],
    permissions: chrome.runtime.ManifestPermissions[] = [],
): Promise<boolean> {
    return chrome.permissions.contains({ origins, permissions })
}
