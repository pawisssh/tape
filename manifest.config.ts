import { defineManifest } from "@crxjs/vite-plugin"

// Replaces the static extension/manifest.json (Phase 5). Preserves upstream's exact
// permission set plus the documented additions (clipboardWrite from Phase 3,
// optional_host_permissions already included "*://*/*" for Phase 4's LLM endpoint
// permission request flow, and windows — added for the Obsidian handoff page's
// clipboard-focus fix: chrome.windows.getCurrent()/chrome.windows.update() force the
// handoff tab's window into focus before writing to the clipboard, since
// navigator.clipboard.writeText() throws when the document isn't focused) — see
// PLAN.md §6 Phase 5 / §8.
//
// unlimitedStorage — added so the meetings list (each entry keeping its full transcript)
// can grow past the default 5MB chrome.storage.local quota; the extension used to trim
// this list to the last 10 meetings specifically to stay under that quota, until the UI
// revamp removed the cap in favor of showing every stored meeting.
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
        // Toolbar button / puzzle-piece extensions-dropdown icon — deliberately a
        // separate file from `icons` below (the Details-page/Web-Store icon), since a
        // detailed icon that reads well at 128px often turns into a blob at the ~16-19px
        // toolbar size. Replace extension/icon-toolbar.png with a simplified icon
        // designed to be legible that small.
        default_icon: "extension/icon-toolbar.png",
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
        "unlimitedStorage",
        "downloads",
        "scripting",
        "declarativeNetRequestWithHostAccess",
        "alarms",
        "sidePanel",
        "clipboardWrite",
        "windows",
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
    // Lets the recording toast/FAB content scripts (extension/content-scripts/**) load
    // extension/icon.png as an <img src> inside the host meeting page — that subresource
    // load is attributed to the host page's own origin under MV3, even though the code
    // inserting it runs at extension privilege.
    web_accessible_resources: [
        {
            resources: ["extension/icon.png"],
            matches: [
                "https://meet.google.com/*",
                "https://teams.live.com/*",
                "https://teams.microsoft.com/*",
                "https://teams.cloud.microsoft/*",
                "https://*.zoom.us/*",
            ],
        },
    ],
})
