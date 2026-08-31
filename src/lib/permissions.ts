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

/**
 * True when `url` would send data unencrypted to somewhere other than the machine running
 * the browser — plain `http://` to a public/remote host. Always false for `https://` (safe
 * regardless of host), and false for `http://` to localhost or a private-network address
 * (legitimate — LM Studio/Ollama default to plain http on localhost, and a self-hosted
 * webhook receiver on a home LAN is exactly as legitimate; warning on those would be noise,
 * not signal). Used by WebhookSection.tsx/ProviderPanel.tsx to gate an inline "this isn't
 * encrypted" warning before Connect proceeds — see PLAN.md §7.2. Never throws; an
 * unparseable URL resolves to `false` (nothing to flag yet — the existing origin-pattern
 * helpers above already treat that case as "can't request a permission for this," which
 * surfaces its own feedback separately).
 */
export function isInsecureUrl(url: string): boolean {
    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        return false
    }
    if (parsed.protocol !== "http:") {
        return false
    }
    // URL.hostname keeps the brackets for an IPv6 literal (e.g. "[::1]", not "::1").
    const host = parsed.hostname
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") {
        return false
    }
    // RFC 1918 private ranges + link-local (RFC 3927) — self-hosted servers on a home/office
    // LAN, not exposed to the wider internet.
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return false
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return false
    if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)) return false
    if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) return false
    return true
}
