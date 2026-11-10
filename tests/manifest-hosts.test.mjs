import { test } from "node:test"
import assert from "node:assert/strict"
import manifest from "../manifest.config.ts"
import { PLATFORM_CONFIGS } from "../extension/background-script/config.js"

// Chrome ignores the path of a host permission, so compare scheme + host only.
const origin = (pattern) => pattern.replace(/^([^:]+:\/\/[^/]+).*$/, "$1")

// "*://*/*" is there for the user's LLM endpoint, not meeting hosts: a platform host
// covered only by it would hide a missing entry.
const declared = (patterns) => new Set(patterns.filter(p => p !== "*://*/*").map(origin))

const resolved = typeof manifest === "function" ? await manifest({ command: "build", mode: "production" }) : manifest
const hostPermissions = declared([...(resolved.host_permissions ?? []), ...(resolved.optional_host_permissions ?? [])])
const fabIconMatches = declared(resolved.web_accessible_resources.flatMap(entry => entry.matches))

for (const [platform, config] of Object.entries(PLATFORM_CONFIGS)) {
    test(`${platform} content-script hosts are declared in the manifest`, () => {
        for (const pattern of config.matches) {
            assert.ok(hostPermissions.has(origin(pattern)), `${pattern} missing from host_permissions / optional_host_permissions in manifest.config.ts`)
            assert.ok(fabIconMatches.has(origin(pattern)), `${pattern} missing from web_accessible_resources matches in manifest.config.ts (FAB icons won't load)`)
        }
    })
}
