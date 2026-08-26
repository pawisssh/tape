import { resolve } from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { crx } from "@crxjs/vite-plugin"
import { viteStaticCopy } from "vite-plugin-static-copy"
import manifest from "./manifest.config.ts"

// See PLAN.md §6 Phase 5 for the two CRXJS build gotchas this file has to solve:
//
// 1. extension/content-scripts/** is registered at RUNTIME via
//    chrome.scripting.registerContentScripts() (extension/background-script/config.js's
//    PLATFORM_CONFIGS, referenced as plain "content-scripts/..." relative paths) — it is
//    never declared in the manifest, so CRXJS's manifest-driven bundling never sees it.
//    We copy extension/content-scripts/** into dist/content-scripts/** completely
//    unmodified (no Vite/esbuild transform at all) via vite-plugin-static-copy, and this
//    is verified with a byte-diff as part of the Phase 5 Definition of Done.
//
// 2. meetings.html and extension/obsidian/handoff.html are only ever reached via
//    chrome.runtime.getURL() at runtime — never declared in the manifest — so Vite's
//    default Rollup input detection (which only looks at manifest-referenced pages via
//    the crx() plugin) never discovers them either. We add them explicitly via
//    build.rollupOptions.input. Vite mirrors an HTML input's own source path (relative
//    to this config's root, i.e. the repo root) into dist/, NOT the Rollup input object's
//    key — so the two source files are kept at the exact repo-relative path their
//    getURL() callers use: meetings.html physically lives at the repo root (matching
//    getURL("meetings.html") / the bare "meetings.html" navigations in
//    extension/background-script/{utils,exporters}.js and extension/popup),
//    and extension/obsidian/handoff.html stays inside extension/obsidian/ (matching the
//    one getURL("extension/obsidian/handoff.html") call site in
//    extension/background-script/meetings.js — that call site's string was updated to
//    include the "extension/" prefix as part of this wiring; see that file for the
//    one-line change).
export default defineConfig({
    plugins: [
        react(),
        tailwindcss(),
        crx({ manifest }),
        viteStaticCopy({
            targets: [
                {
                    src: "extension/content-scripts/**/*",
                    dest: "content-scripts",
                    rename: { stripBase: 2 },
                },
                // extension/side-panel/index.html links side-panel.js with a plain (non-module)
                // <script src>, so Vite's HTML pipeline leaves that reference untouched rather
                // than bundling it (see the "can't be bundled without type=module" build warning)
                // — the side panel is carried over from upstream as-is (Phase 5 build-sequencing
                // step 7: only rebuilt in React "if time allows", otherwise left alone), so the
                // plain script is copied verbatim alongside the CRXJS-processed HTML instead of
                // being rewritten to a module script.
                {
                    src: "extension/side-panel/side-panel.js",
                    dest: "extension/side-panel",
                    rename: { stripBase: 2 },
                },
            ],
        }),
    ],
    build: {
        rollupOptions: {
            input: {
                meetings: resolve(import.meta.dirname, "meetings.html"),
                handoff: resolve(import.meta.dirname, "extension/obsidian/handoff.html"),
            },
        },
    },
    resolve: {
        alias: {
            "@": resolve(import.meta.dirname, "./src"),
        },
    },
})
