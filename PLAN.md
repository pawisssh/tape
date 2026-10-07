# Implementation Plan: Tape

**Document type:** Hand-off spec for an implementing AI. Written by the tech-lead session; the same tech-lead session will review the work against this document once implementation is reported complete. Follow it directly — do not re-derive the architecture decisions below, they are the result of prior research and are settled unless explicitly marked "confirm."

---

## 1. Objective

Build a Chrome extension in `/Users/kane/Projects/meet-to-obsidian/tape`, forked from `vivek-nexus/transcriptonic` (MIT, captures live Google Meet/Teams/Zoom captions), that adds two capabilities on top:

1. On meeting end, save the transcript as a Markdown note directly into an Obsidian vault.
2. Optionally enrich that note with a summary from a locally-running LLM server (LM Studio / Ollama, OpenAI-chat-completions-compatible), producing Fathom/tl:dv/Scribbl-style sections: Summary, Key Topics, Action Items, Decisions, Open Questions, Next Steps.

The UI (popup, meeting history page, Obsidian handoff page) is rebuilt with Vite + React + shadcn/ui, with shadcn configured on **Base UI** (base-ui.com) as its primitives backend — not the older Radix backend.

## 2. Non-goals for v1 (do not build these; flag if tempted to add scope)

- In-meeting pause/resume control or any FAB/overlay redesign beyond what upstream already ships. Keep upstream's existing floating indicator, only reskin its CSS in Phase 5 if trivial.
- Verifying Teams or Zoom capture end-to-end. Their content-script code is carried over from upstream untouched; only Google Meet gets a live manual verification pass.
- Any mechanism to confirm Obsidian actually wrote the file. `obsidian://` has no callback — "sent" is the ceiling of what this extension can ever claim, by design, not a bug to fix.
- A "summarize without Obsidian" standalone trigger. The LLM step only runs as part of the Obsidian handoff pipeline in v1; its output is also shown read-only in the history page, but there's no separate "summarize this meeting" button.
- Converting `extension/content-scripts/**` or `extension/background-script/**` to TypeScript. They get `@ts-check` + JSDoc typedefs only, never `.ts` conversion.
- Any change to `/Users/kane/Projects/meet-to-obsidian/transcriptonic-v2` or the `pawisssh/meet-to-obsidian` GitHub repo. That project is reference material only, read-only, untouched.

## 3. Reference material (read, do not copy code from)

- Upstream: `github.com/vivek-nexus/transcriptonic`, MIT, default branch `main`, latest release v3.4.2 (2026-08-04).
- `/Users/kane/Projects/meet-to-obsidian/transcriptonic-v2` — a sibling fork of the same upstream that already solved this exact problem (Obsidian export + local LLM + shadcn/Vite UI, but on Radix, not Base UI). Its design decisions are threaded through this plan (URI encoding rules, LLM fallback discipline, CRXJS build gotchas, etc.) because they're already battle-tested. Re-derive the implementation from scratch in `tape`; do not import or copy its files.
- A screenshot the user provided of Scribbl's real post-meeting page (title, Notes/Transcript tabs, a "writing your notes" loading state, and a per-speaker panel showing avatar/name/talk-time/percentage/timeline bar) — useful concrete reference for the history page in Phase 5, optional to emulate the speaker-timeline visual.

## 4. Settled assumptions (do not re-ask the user; proceed on these)

| Decision | Value |
|---|---|
| New GitHub fork name | `pawisssh/tape` (public), with `upstream` remote → `vivek-nexus/transcriptonic` |
| Platform scope | Meet/Teams/Zoom code all carried over; only Meet manually verified live |
| FAB pause/resume | Deferred, not built |
| Upstream's anonymous error-logging (Google Apps Script fetch calls) | Stripped from the fork |
| Package manager | npm |
| shadcn CLI | `npx shadcn@latest init -b base` — **implementing AI must run `npx shadcn@latest --help` first and confirm this flag still exists/behaves as documented before relying on it; if it's changed, adapt and note the actual command used in the PR/report** |

## 5. Architecture overview

```
Content script (Meet/Teams/Zoom, upstream code, untouched)
  → chrome.storage.local: meetingTitle, transcript[], chatMessages[], meetingStartTimestamp
  → on meeting end: "meeting_ended" message OR tab-close detected

Background service worker (extension/background-script/, upstream + minimal additions)
  → meetings.js: pickupLastMeetingFromStorage() builds a Meeting record, appends to
    chrome.storage.local["meetings"] (last 10 kept)
  → processLastMeeting(): runs existing exporters (download .txt, webhook) plus, if
    Obsidian auto-save is on, opens the handoff page fire-and-forget (never blocks
    the other exporters, never waits on a slow LLM call)

Handoff page (extension/obsidian/handoff.html → React, a normal extension page with
unlimited lifetime and clipboard access — NOT the service worker)
  1. load meeting + settings
  2. buildMarkdown(meeting)                              [extension/obsidian/markdown.js]
  3. optional: enrichWithLlm(meeting, config) → merge into markdown  [extension/obsidian/llm.js]
  4. decide inline content= vs. clipboard delivery         [extension/obsidian/uri.js]
  5. navigate to obsidian://new?vault=...&file=...&content=...
  6. mark meeting.obsidianSaveStatus = "handed_off" (optimistic, no delivery confirmation)

History page (extension/meetings.html → React) and popup: settings forms, per-meeting
status/actions, read-only LLM summary display.
```

## 6. Phase plan

Build in this order. Each phase has a **Definition of Done** — do not start the next phase until the current one's DoD is met. Phases 1, 3, 4, 5 end in a manual-verification step that requires a human joining a real Google Meet call and a real Obsidian vault/local LLM server; the implementing AI cannot perform these itself — prepare everything needed (built/loaded extension, a `MANUAL_TESTING.md` checklist for that phase) and hand it back to the user to run, then incorporate their reported results before proceeding.

### Phase 0 — Bootstrap

```bash
cd /Users/kane/Projects/meet-to-obsidian
mkdir -p tape-reference && mv tape/*.png tape-reference/   # move the reference screenshot aside first
gh api -X POST /repos/vivek-nexus/transcriptonic/forks -f name=tape
git clone https://github.com/pawisssh/tape.git tape
cd tape
git remote add upstream https://github.com/vivek-nexus/transcriptonic.git
```
Fallback if a custom-named fork fails: fork normally (→ `pawisssh/transcriptonic`), `gh repo rename tape`, re-point `origin`.

Immediately after cloning, before any code changes: commit this entire document into the repo as `PLAN.md` at the repo root (copy it verbatim from `/Users/kane/.claude/plans/goal-i-want-serene-wren.md`). This is the checked-in source of truth for the implementing AI and for the tech-lead review in §9 — every phase's Definition of Done and every module spec below should be read from that file, not re-derived.

**DoD:** `tape` is a git repo with `origin` = `pawisssh/tape`, `upstream` = `vivek-nexus/transcriptonic`, containing upstream's code at HEAD plus a committed `PLAN.md`.

### Phase 1 — Baseline verification

Load `extension/` unpacked in `chrome://extensions` (Developer mode → Load unpacked). Hand off to the user: join a real Meet call, enable captions, talk, end the call.

**DoD:** user confirms the `.txt` transcript downloaded and the meeting appears in `meetings.html`/popup/side panel, unmodified from upstream behavior.

### Phase 2 — Type scaffolding

- Add root `tsconfig.json` (`allowJs, checkJs, strict:false, skipLibCheck`) targeting `types/**` + `extension/**`, alongside upstream's existing `jsconfig.json`.
- New Obsidian/LLM files (Phase 3+) get `@ts-check` + a reference to `types/index.js`. Extend `types/index.js` (or add `types/obsidian.js`) additively for new message types — never alter existing typedef shapes.
- Do not touch `extension/content-scripts/**` or `extension/background-script/**` beyond what Phase 3/4 wiring strictly requires.

**DoD:** `npx tsc --noEmit` (per the config above) is clean, or every error is one that already existed pre-Phase-2 (document which).

### Phase 3 — Obsidian export (vanilla JS, no bundler)

Create:
```
extension/obsidian/markdown.js   # pure functions, no chrome.*, no network
extension/obsidian/uri.js        # pure functions
extension/obsidian/store.js      # chrome.storage access
extension/obsidian/handoff.html
extension/obsidian/handoff.js    # orchestrates the flow described in §5
```

**`markdown.js` responsibilities:** build frontmatter (title/date/start/end/duration/software/participants), group the transcript by consecutive speaker, render `## Transcript` (+ `## Chat messages` if non-empty), build the filename from a template with `{{date}} {{time}} {{title}} {{software}}` tokens — sanitize each token individually before substitution (a `/` inside a meeting title must never become a path separator), strip illegal filesystem characters, guard Windows reserved device names and leading/trailing dots.

**`uri.js` responsibilities:** build `obsidian://new?vault=...&file=...&content=...` by hand with `encodeURIComponent` per param — **not** `URLSearchParams` (it encodes spaces as `+`, which Obsidian treats literally in filenames). Never emit `overwrite=`/`append=` (rely on Obsidian's own collision-uniquify behavior). Pick a conservative empirical length threshold (document the number and reasoning as a comment — there is no authoritative OS URI-length limit) below which the note goes inline via `content=`; above it, switch to clipboard delivery with `&clipboard=true` and write the note to the OS clipboard instead.

**`store.js` responsibilities:** get/update a meeting record by a stable id, always read-modify-write (re-read storage before writing) since other exporters may write concurrently; if clipboard delivery is used, guard against two handoffs racing the clipboard (a lock with a TTL is sufficient — document the race it does *not* fully eliminate rather than overclaiming correctness).

**`handoff.html`/`handoff.js` responsibilities:** implement the 6-step flow in §5. Why this must be a separate extension page, not the service worker: an MV3 service worker is killed ~30s after its last extension-API call (too short for a slow local LLM call in Phase 4); it has no clipboard access; launching a custom-protocol URI needs a real, focused tab (the meeting tab may have just closed); and a stable extension-origin page is what lets Chrome remember "Always allow" for the `obsidian://` prompt across future meetings.

**Settings (new `chrome.storage.sync` keys):** `autoSaveToObsidianAfterMeeting` (bool, default false), `obsidianVaultName` (string, must exactly match Obsidian's vault switcher name), `obsidianFolder` (string, vault-relative, empty = root), `obsidianFileNameTemplate` (string, default `"{{date}} - {{title}}"`).

**Wiring into `extension/background-script/`:** on `processLastMeeting()`, after existing exporters run, if `autoSaveToObsidianAfterMeeting && obsidianVaultName`, mark the meeting `obsidianSaveStatus: "pending"` and `chrome.tabs.create` the handoff page fire-and-forget (must not await it, must not let a slow/failed handoff block or fail the other exporters). A manual "Save to Obsidian" action from the history page (added in Phase 5, but the message handler for it belongs here) reuses the identical handoff-page path with `auto:false`.

Keep the upstream `.txt` download as an always-on fallback unless another exporter (webhook or Obsidian) is active — never leave the user with zero export paths.

**Unit tests:** `tests/obsidian.test.mjs` (or split per module) via `node --test`, covering: frontmatter YAML-injection safety, speaker-grouping, filename sanitization (illegal chars, reserved names, token expansion, truncation), URI param encoding (space-vs-plus, no overwrite/append), inline-vs-clipboard threshold behavior.

**DoD (MVP milestone):**
- `node --test` passes for `markdown.js`/`uri.js`.
- User has run a real Meet call end-to-end with Obsidian configured, confirmed: the "Open Obsidian?" prompt appeared once and "Always allow" suppressed it afterward; the `.md` file landed in the correct vault/folder/filename with correct frontmatter and transcript; a meeting title containing `/ : # [ ]` didn't break anything; manual "Save to Obsidian" worked for a past meeting.
- Write results into `MANUAL_TESTING.md`.

### Phase 4 — Local LLM summary enrichment

Create `extension/obsidian/llm.js`.

**Non-negotiable rule:** any failure (server unreachable, network error, timeout/abort, non-2xx, unparseable JSON, empty response) must silently fall back to the plain Phase-3 markdown note. The raw transcript capture and the plain-markdown export are never allowed to depend on this step succeeding — implement this as the caller always getting `null` on failure and treating `null` as "skip enrichment," never as an exception it must handle specially.

**Settings additions:** `obsidianUseLlm` (bool, default false), `obsidianLlmEndpoint` (default `http://localhost:1234/v1/chat/completions`; document Ollama's equivalent, typically `http://localhost:11434/v1/chat/completions`, in the README as an alternative), `obsidianLlmModel` (string, no hardcoded default tied to a specific model — leave blank or a widely-known generic instruct model name, user must set it to whatever they've pulled locally), `obsidianLlmTimeoutMs` (default 90000).

**Request contract:** `POST {endpoint}`, body `{model, temperature: 0.3, stream: false, messages: [system, user]}`, `AbortController` wired to the configured timeout.

**System prompt** must instruct the model to reply with exactly one JSON object, no prose/fences, matching:
```json
{
  "title": "string, <=60 chars, no / : # [ ] | ^",
  "summary": "2-5 sentence markdown",
  "topics": [{"heading": "string", "points": ["string"]}],
  "actionItems": [{"task": "string", "owner": "string?", "dueDate": "string?"}],
  "decisions": ["string"],
  "openQuestions": ["string"],
  "nextSteps": ["string"]
}
```
Include explicit instructions: leave arrays empty rather than invent content; never invent an owner or date not stated in the transcript; write in the transcript's own language; only populate `topics` when the meeting naturally splits into distinct themes.

**Response parsing** must tolerate real local-model output quirks: `<think>...</think>` reasoning blocks, ```` ```json ``` ```` code fences, chatty text before/after the JSON object — strip/extract before `JSON.parse`; any parse failure returns `null`, never throws. Each output section renders independently in the final markdown (a response with only `summary` still produces a valid, shorter note; a topic with a missing heading or empty points is dropped rather than rendered blank).

**Wiring:** runs inside `handoff.js`, right before `buildMarkdown()`, injecting `{title, summaryMarkdown}` as options into the same builder used in Phase 3. Also surface the cached summary read-only in a meeting's row on the history page (Phase 5) for users without Obsidian configured — no separate trigger button for this in v1.

**Permissions:** reuse upstream's `optional_host_permissions: ["*://*/*"]`; request narrowed to the configured endpoint's origin via `chrome.permissions.request`, called from the settings checkbox's own click handler (must be a genuine user gesture, not a blur/effect). The extension must remain fully functional with this permission never granted.

**Unit tests:** JSON-parsing helper against fixtures (plain JSON, fenced, think-block-wrapped, chatty preamble, malformed, non-object) and the summary-markdown-rendering function (section presence/absence, ordering, malformed-field robustness).

**DoD:**
- `node --test` passes for the new `llm.js` pure-parsing/rendering functions.
- User has run a real Meet call with a real local LLM server (LM Studio or Ollama) reachable, confirmed the resulting note has only the sections the model actually returned, stated owners/dates show correctly, and unstated ones aren't invented.
- User has confirmed that stopping the local server (or a forced very-low timeout) still produces a successful plain-transcript export with no hang or visible error blocking the flow.
- Append results to `MANUAL_TESTING.md`.

### Phase 5 — Full UI rewrite: Vite + CRXJS + React + TS + Tailwind + shadcn/ui on Base UI

```bash
npm install -D vite @crxjs/vite-plugin @vitejs/plugin-react typescript \
  tailwindcss @tailwindcss/vite vite-plugin-static-copy @types/chrome @types/react @types/react-dom
npm install react react-dom
npx shadcn@latest init -b base
```

`manifest.config.ts` (via `defineManifest`) replaces static `manifest.json`, preserving upstream's exact permission set plus `clipboardWrite` (needed for the Phase-3 clipboard fallback) and Phase 4's optional host permission for the LLM endpoint.

**Two build gotchas to solve correctly in `vite.config.ts`:**
1. Content scripts registered at runtime via `chrome.scripting.registerContentScripts()` (not declared in the manifest) are invisible to CRXJS's manifest-driven bundling. Use `vite-plugin-static-copy` to copy `extension/content-scripts/**` into `dist/content-scripts/**` unmodified, verified with a byte-diff.
2. Any HTML page reached only via `chrome.runtime.getURL()` — `meetings.html`, `extension/obsidian/handoff.html` — is invisible to Vite's default Rollup input detection. Add explicit `build.rollupOptions.input` entries for them, **and** keep the HTML shell files physically at the same repo-relative path the runtime `getURL()` call uses (Vite mirrors the input file's own path in its output, not the Rollup input key) — only their React source (`main.tsx`/`App.tsx`) lives under `src/`.

**Build sequencing (verify incrementally, don't build all pages at once):**
1. Empty Vite+CRXJS+React shell that builds and loads unpacked with zero shadcn — confirms manifest/build wiring in isolation.
2. `shadcn init -b base` + one test component (e.g. Button); load it and inspect the rendered DOM to confirm Base UI primitives (not Radix) are what's actually mounting.
3. Popup — status + settings shortcuts.
4. History/meetings page (`src/meetings/`) — the largest surface: meeting table (reused/adapted from upstream's data model), per-row export-status badges and actions (download, webhook retry, manual "Save to Obsidian", delete), Obsidian settings form (vault/folder/filename template/auto-save toggle), LLM settings form (endpoint/model/timeout/enable toggle — enable toggle's click handler is what triggers the permission request), read-only expandable LLM summary per row. Optional: a per-speaker talk-time visualization on a meeting's detail view, inspired by the Scribbl reference screenshot — nice-to-have, not required for DoD.
5. Obsidian handoff page (`src/obsidian-handoff/`) — a status stepper (load → markdown → llm → clipboard/inline → launch), each step showing pending/active/done/skipped/failed, with a "Close tab" button that is **not** auto-triggered (the `obsidian://` prompt is tab-modal — an auto-close would dismiss it before the user answers).
6. In-meeting FAB — reskin CSS only if trivial; do not rebuild in React (shadow-DOM/CSS-scoping/bundle-size cost isn't worth it for one floating button in v1).
7. Side panel, only if time allows — otherwise carry over upstream's as-is.

**Structural rule to preserve:** `extension/obsidian/{markdown,uri,llm,store}.js` stay exactly where they are, framework-free, imported directly by both the new React pages and the test suite — never bundled or duplicated into `src/`. New `src/lib/{chrome-storage.ts,messaging.ts,permissions.ts,utils.ts}` hold thin React-side wrappers only.

**DoD:**
- `npm run build` produces `dist/` that loads unpacked with zero console errors.
- `dist/content-scripts/**` verified byte-identical to `extension/content-scripts/**`.
- Popup, history page, and handoff page all render and function correctly.
- Base UI primitives confirmed via DOM inspection (not accidentally still Radix).
- User has re-run the full Phase 3 + Phase 4 manual checklists against the new UI and confirmed no regression.

### Phase 6 — Final QA + docs

- Full manual checklist re-run from a clean `chrome.storage` state (fresh Chrome profile or remove+re-add the extension).
- `npm test` and `npm run typecheck` both green.
- `README.md` covering: install-from-source steps, Obsidian vault/folder/filename config with one worked example, local-LLM setup instructions for both LM Studio and Ollama, and explicitly documented known limits (status is "sent," never "confirmed saved"; vault name must match exactly; destination folder must already exist; the "Open Obsidian?" prompt is tab-modal and closing the tab early dismisses it).

**DoD:** all of the above complete; `MANUAL_TESTING.md` shows every phase's checklist checked off against the final build.

### Phase 7 — Hardening, security & cleanup (2026-08-31 review findings)

Phases 0–6 above are complete and the extension has grown well past their original DoD (visual redesign, multi-provider LLM support, context-window pre-flight detection + buffered comparison, real request cancellation, a 3-state capture-mode toggle, etc. — none of that is re-litigated here). This phase captures findings from a full code/architecture/UX review of the extension as it stands today, ordered by severity. Each item is independent — implement and ship them in any order, one at a time, not as a single big change.

**7.1 — Fix the duplicate-processing race in the background script (highest priority, correctness bug)**

`"meeting_ended"` (`extension/background-script/index.js:35-60`) and `chrome.tabs.onRemoved` (`index.js:274-294`) can both fire for the same meeting close. Both do check-then-act on the `meetingTabId` sentinel across separate async `chrome.storage.local.get`/`.set` calls with no atomicity — a meeting-end click followed shortly by the tab actually closing (a realistic sequence) can let both handlers read the pre-"processing" value before either write commits, running `processLastMeeting()` twice concurrently. `pickupLastMeetingFromStorage()` (`meetings.js:72-121`) and `postTranscriptToWebhook()` (`exporters.js:97-171`) both then do their own unguarded read-modify-write on the `meetings` array, so this can produce duplicate meeting entries, duplicate downloads/webhook posts, or a lost webhook-status update.

Fix: introduce a single, explicit finalization guard — e.g. an in-memory `Set`/flag keyed by the meeting's stable id (or the existing `meetingTabId` sentinel, but written and checked as close together as possible, ideally within one storage transaction shape) that both `"meeting_ended"` and `onRemoved` check before calling `processLastMeeting()`, so only the first one to arrive actually runs it. Since `chrome.storage.local` has no compare-and-swap, the practical fix is to serialize the check+set into a single code path both listeners call through (a shared async function that itself holds a simple in-worker mutex/promise-chain — the service worker is single-threaded per event loop tick, so a plain in-memory flag checked synchronously before the first `await` is sufficient to close the window between the two listeners, unlike the current cross-listener storage round trip).

**DoD:** a unit test (new, under `tests/` — this is the first automated coverage for `background-script/`) simulating both listeners firing in quick succession against a faked `chrome.storage` resolves to exactly one `processLastMeeting()` invocation. Manual: end a meeting via the in-page "Leave" button (which triggers both the content script's `meeting_ended` message and, moments later, the tab close) and confirm exactly one meeting entry appears, not two.

**7.2 — Webhook (and custom LLM provider) HTTPS enforcement**

Neither `WebhookSection.tsx` nor `ProviderPanel.tsx` validate the URL scheme before saving/connecting — a plain `http://` endpoint is accepted silently, and meeting transcripts (webhook) or transcript+API-key (LLM provider) get sent unencrypted with no warning anywhere in the UI.

Fix: in both components' save/connect handlers, if the entered URL's scheme is `http:` (not `https:`) and the host isn't `localhost`/`127.0.0.1`/a private-network address (local LLM servers are legitimately plain HTTP on localhost — don't warn on those), show an inline warning ("This endpoint isn't encrypted — data sent to it can be intercepted") requiring an explicit acknowledgement before Connect proceeds, rather than blocking outright.

**DoD:** unit tests for the new scheme-check helper (accepts https always; accepts http only for localhost/private ranges; flags everything else) in `tests/`. Manual: entering a public `http://` webhook/provider URL shows the warning; `https://` and `http://localhost:*` do not.

**7.3 — README privacy claim is stale**

`README.md` states transcript data "does not leave the device, unless you configure a webhook" — omitting that a configured cloud/custom AI provider also sends transcript content off-device. Fix: update that paragraph to cover both paths (webhook and AI provider), and add a short feature-list update covering Obsidian export, Templates, and multi-provider AI summarization, none of which the README currently mentions at all.

**DoD:** README reviewed against the actual current feature set; no factual gaps between what's shipped and what's documented.

**7.4 — `ProviderPanel.tsx`'s two divergent save paths**

Fields autosave on a 700ms debounce with zero visible feedback, entirely separate from the explicit "Connect" button's own save-plus-permission-request. A user who edits and navigates away without clicking Connect has silently persisted (including a secret API key) with no confirmation anything happened, and the two paths are a drift risk (a fix applied to one can be missed in the other).

Fix: keep the debounced autosave (permission requests genuinely need a real click, so Connect can't fully subsume it), but give the autosave a visible, low-key confirmation (e.g. a transient "Saved" label near the field, not a toast) so the two paths are at least both legible to the user.

**DoD:** manual check — editing any field shows a brief save confirmation without needing to click Connect.

**7.5 — Platform toggle "(beta)" label inconsistency**

`src/popup/App.tsx` labels Teams/Zoom "(beta)"; `IntegrationsView.tsx` labels the identical setting plainly, with no qualifier. Fix: match the wording in both places (simplest: adopt whichever is still accurate — check with the user if Teams/Zoom are still meant to be beta before picking one).

**DoD:** grep confirms one consistent label string used in both surfaces.

**7.6 — Template import accepts anything silently**

`templateFromWebClipperJson` (`extension/obsidian/templates.js:254-287`) never throws — arbitrary JSON becomes an empty "Imported template" with a success toast, giving no signal that the wrong file was pasted/dropped.

Fix: add a minimal shape check before treating the parsed JSON as a template (e.g. require at least one of `name`/`properties`/`noteContent` to be present and roughly the right type) and surface an error toast instead of a false-positive success when it fails.

**DoD:** unit test in `tests/templates.test.mjs` covering: a valid template imports normally (unchanged); `{}` or an unrelated JSON shape is rejected with an error toast, not a silent empty template.

**7.7 — Dependency/dead-code cleanup**

- Remove the unused `material-symbols` package from `package.json` (only `@material-symbols/svg-400` is actually used, and only indirectly — SVGs already copied into `src/meetings/ui/icons.tsx`).
- Move `shadcn` from `dependencies` to `devDependencies` (it's a codegen CLI, not a runtime import).
- Remove `waitForElementByStyle` (`extension/content-scripts/common-utils.js`) — defined, never called.

**DoD:** `npm run build` and `npm test` both still pass after removal; `grep -r "material-symbols[^/]" src/ extension/` (excluding the `/svg-400` sub-package) returns nothing.

**Deliberately out of scope for this phase** (flagged, not built — larger, separate efforts): reducing the ~80%-duplicated content-script skeleton across google-meet/teams/zoom into a shared orchestration function; adding any DOM-selector fallback/resilience strategy for Google Meet's hardcoded obfuscated class names; broader automated test coverage for `content-scripts/` (beyond 7.1's one new race-condition test). These are real, but each is its own multi-day investigation-plus-implementation effort, not a hardening pass.

## 7. Target file structure

```
manifest.config.ts, vite.config.ts, tsconfig*.json, components.json, package.json

extension/
  background-script/{config,exporters,index,meetings,platforms,utils}.js   # upstream, minimally touched
  content-scripts/**                                                        # upstream, untouched
  obsidian/{markdown,uri,llm,store}.js
  obsidian/handoff.html
  icon.png, icons/*.svg, rules.json

meetings.html                     # repo root — Vite output-path constraint, see Phase 5

src/
  popup/{index.html,main.tsx,App.tsx}
  meetings/{main.tsx,App.tsx,MeetingRow.tsx,MeetingsSection.tsx,ObsidianSection.tsx,WebhookSection.tsx}
  obsidian-handoff/{main.tsx,App.tsx}
  side-panel/{index.html,main.tsx,App.tsx}   # if kept in v1
  components/ui/**                            # shadcn-generated, Base UI backed
  lib/{chrome-storage.ts,messaging.ts,permissions.ts,utils.ts}
  types/messages.ts
  styles/globals.css

types/{chrome.d.ts,index.js}      # upstream JSDoc typedefs, extended additively
tests/                             # node --test, obsidian export + LLM parsing units
MANUAL_TESTING.md
README.md
```

## 8. Critical files (highest correctness risk — tech-lead review will focus here first)

- `vite.config.ts` — both CRXJS gotchas from §Phase 5 live here; getting either wrong silently breaks the build in ways that only surface at runtime, not at build time.
- `manifest.config.ts` — must exactly preserve upstream's permission set plus the two documented additions, or capture/export silently degrades.
- `extension/obsidian/markdown.js` — correctness here directly determines what lands in the user's vault.
- `extension/obsidian/uri.js` — the most failure-prone hand-rolled encoding logic (space-vs-plus, inline-vs-clipboard threshold, never-overwrite guarantee).
- `extension/obsidian/llm.js` — enforces the "never lose the transcript on LLM failure" fallback discipline; this is the single property most worth scrutinizing in review.
- `extension/background-script/index.js` / `meetings.js` — the meeting-lifecycle message hub; new Obsidian/LLM-trigger messages must not disturb upstream's existing `meeting_ended`/tab-close race-guard logic (the `meetingTabId: "processing"` sentinel pattern).

## 9. Review protocol (tech lead, after implementation is reported complete)

When the implementing AI reports a phase (or the whole plan) complete, review will check, in this order:
1. **Scope discipline** — nothing from §2 Non-goals was built; no phase was skipped or reordered without a stated reason.
2. **DoD literally met** — for each completed phase, the stated Definition of Done is satisfied, including that `MANUAL_TESTING.md` reflects actual user-run results, not assumed/simulated ones (no session can fake a real Meet call or a real local LLM server).
3. **Critical files** (§8) read in full and checked against their specific correctness requirements above, not just skimmed.
4. **Automated verification actually run** — `node --test`, `tsc --noEmit`, `vite build`, and the `dist/content-scripts` byte-diff, with real command output inspected, not just claimed.
5. **Fallback/failure-path behavior spot-checked** — deliberately break each optional dependency (no Obsidian installed, LLM server down, malformed LLM JSON, oversized note) and confirm graceful degradation matches the spec, not just the happy path.
6. **Structural boundaries preserved** — pure logic modules stay framework-free and un-duplicated; content-scripts/background-script stay close to upstream.

Any deviation gets flagged back to the implementing AI with the specific file/line and the specific requirement from this document it fails, for a fix-and-resubmit — not a full re-plan.
