import { defineManifest } from "@crxjs/vite-plugin"

// Replaces the static extension/manifest.json (Phase 5). Preserves upstream's exact
// permission set plus the two documented additions (clipboardWrite from Phase 3,
// optional_host_permissions already included "*://*/*" for Phase 4's LLM endpoint
// permission request flow) — see PLAN.md §6 Phase 5 / §8.
//
// HTML page paths below are the *source* paths CRXJS/Vite bundle from — for pages
// declared here (action.default_popup, side_panel.default_path), CRXJS automatically
// rewrites the manifest it emits into dist/ to point at wherever Vite actually placed
// the built output, so their source location doesn't need to match a runtime
// chrome.runtime.getURL() string anywhere. That constraint only applies to
// meetings.html and extension/obsidian/handoff.html, which are reached exclusively via
// getURL() and are therefore NOT declared in this manifest — see vite.config.ts for how
// those two are wired in instead.
export default defineManifest({
    manifest_version: 3,
    name: "TranscripTonic",
    version: "3.4.2",
    description: "Simple Google Meet transcripts. Private and open source.",
    action: {
        default_icon: "extension/icon.png",
        default_popup: "src/popup/index.html",
    },
    side_panel: {
        default_path: "extension/side-panel/index.html",
    },
    icons: {
        128: "extension/icon.png",
    },
    permissions: [
        "storage",
        "downloads",
        "scripting",
        "declarativeNetRequestWithHostAccess",
        "alarms",
        "sidePanel",
        "clipboardWrite",
    ],
    host_permissions: ["https://meet.google.com/*"],
    optional_permissions: ["notifications"],
    optional_host_permissions: [
        "*://*/*",
        "https://*.zoom.us/",
        "https://teams.live.com/*",
        "https://teams.microsoft.com/*",
        "https://teams.cloud.microsoft/*",
    ],
    background: {
        service_worker: "extension/background-script/index.js",
        type: "module",
    },
    declarative_net_request: {
        rule_resources: [
            {
                id: "ruleset_1",
                enabled: false,
                path: "extension/rules.json",
            },
        ],
    },
})
