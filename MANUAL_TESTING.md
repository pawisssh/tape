# Manual testing checklist

This file is the human-run verification gate referenced in `PLAN.md`. No automated
session can complete these steps — they require a real Google Meet call, a real
Obsidian installation, and (for Phase 4, not yet implemented) a real local LLM server.
Run through each phase's checklist in order and record the result (date + pass/fail +
notes) once done.

---

## Before you start: load the extension

**As of Phase 5, the extension is built with Vite and loaded from `dist/`, not from the
`extension/` folder directly.** `extension/` no longer contains its own `manifest.json` —
building is required.

1. From the repo root, run `npm install` (first time only) then `npm run build`. This
   produces a `dist/` folder.
2. Open `chrome://extensions`.
3. Enable "Developer mode" (top right).
4. Click "Load unpacked" and select the `dist/` folder in this repo (not `extension/`
   and not the repo root).
5. Confirm the extension loads with no errors shown on the extensions page.

If you re-run `npm run build` after pulling new changes, click the reload icon for the
extension on `chrome://extensions` (or remove and re-add it) to pick up the new `dist/`
contents — Chrome does not watch the folder for changes.

Steps 1-2 for Phases 1/3/4 below (which predate the Phase 5 rewrite) still say "load
`extension/` unpacked" in a couple of places from when they were first written — treat
every such reference as "load `dist/` unpacked" per the steps above; the underlying
settings/storage/message-passing behavior those phases test is unchanged by Phase 5.

---

## Phase 1 — Baseline verification (already completed)

Already confirmed by the user prior to this round of work: `.txt` transcript downloads
after a real Meet call, and the meeting appears in `meetings.html`/popup/side panel,
unmodified from upstream behavior.

---

## Phase 3 — Obsidian export manual verification

### Step A: configure the Obsidian settings in the extension UI

1. Click the TranscripTonic extension icon, or open `chrome://extensions`, find
   TranscripTonic, and click "Details" → "Extension options" — either way, get to the
   meetings page (`meetings.html`). You can also open it directly by clicking "last 10
   meetings" from the popup, or navigating to
   `chrome-extension://<your-extension-id>/meetings.html`.
2. Scroll to the **"Save transcripts to Obsidian"** section (it's the first settings
   section on the page, above "Integrate TranscripTonic with your favourite tools").
3. In **Vault name**, enter the exact name of your Obsidian vault as shown in Obsidian's
   vault switcher (Settings icon → vault name at the top, or the vault-switcher popup in
   the left sidebar). This is case-sensitive and must match exactly — e.g. if your vault
   is named `Work Notes`, type `Work Notes`, not `work notes` or `WorkNotes`.
4. In **Folder (optional)**, enter a vault-relative folder path that **already exists**
   in your vault, e.g. `Meetings/TranscripTonic`. Leave blank to save notes to the vault
   root. TranscripTonic does not create folders — Obsidian will silently fail to place
   the note in a non-existent folder (behavior depends on your Obsidian version), so
   create the folder in Obsidian first if you use one.
5. In **Filename template**, leave the default `{{date}} - {{title}}`, or try a more
   descriptive one for this test, e.g. `{{date}} {{time}} {{title}} {{software}}`.
   Available tokens: `{{date}}`, `{{time}}`, `{{title}}`, `{{software}}`.
6. Click **Save**. You should see an "Obsidian settings saved!" alert.
7. Check **"Automatically save transcript to Obsidian, after each meeting"**. If you
   see an alert asking you to save a vault name first, go back to step 6 and confirm the
   Save click actually registered (re-check the vault name field still has your value),
   then re-check the box.

### Step B: end-to-end real Meet call with Obsidian configured

8. With Obsidian **running** (the app must be open, or at least installed and
   registered as the OS handler for `obsidian://` links) and the settings from Step A
   in place, join a real Google Meet call, enable captions, talk for a bit (a couple of
   speaker turns is enough), and end the call.
9. Chrome should show a "meet.google.com wants to open Obsidian" (or similarly worded)
   confirmation prompt. Confirm it appears **once**. Click **"Always allow"** (not just
   "Open Obsidian" / "Allow") if Chrome offers that checkbox.
10. Confirm Obsidian opens and creates a new note. Confirm:
    - The note lands in the **vault** you configured (not a different open vault, if you
      have more than one).
    - The note lands in the **folder** you configured (or vault root if you left it
      blank).
    - The **filename** matches your template with tokens correctly substituted (correct
      date, time, meeting title, and software name — "Google Meet").
    - The note's **frontmatter** (the `---`-fenced block at the top) has `title`,
      `date`, `start`, `end`, `duration`, `software`, and `participants` fields, and the
      values look correct for this meeting.
    - The note's **`## Transcript`** section has your actual spoken transcript, grouped
      by speaker turns, in the right order.
    - If you sent any chat messages during the call, confirm a **`## Chat messages`**
      section is present with them; if you didn't, confirm that section is simply
      absent (not present-but-empty).
11. Confirm the meetings page (`meetings.html`) shows this meeting's row with an
    **"Obsidian status"** column reading **"Sent"** shortly after the handoff.
12. Confirm the `.txt` transcript **still downloaded** as usual (Obsidian export must
    never replace or block the existing download fallback) — unless you had also
    turned off "Automatically download transcript text file" elsewhere in the settings,
    in which case this is expected to be skipped.

### Step C: repeat the "Always allow" check

13. Join a second short Meet call (or use "Save to Obsidian" from history, Step D
    below, as a substitute if a second live call isn't convenient) and end it.
14. Confirm Chrome does **not** show the "Open Obsidian?" prompt again — "Always allow"
    from step 9 should have suppressed it, and the note should open directly in
    Obsidian.

### Step D: meeting title with special characters

15. Before or during a Meet call (or by editing a past meeting's title directly on the
    meetings page — click the meeting title text to edit it, matching upstream's
    existing rename-on-blur behavior), set the meeting title to include the exact
    characters: `/ : # [ ]` — for example `Sync / Q3 review: notes #1 [draft]`.
16. Trigger the Obsidian export for that meeting (either let it auto-save, or use the
    manual "Save to Obsidian" button — see Step E).
17. Confirm:
    - The export **does not throw/fail silently** — the "Obsidian status" column
      updates to "Sent" or "Failed" (not stuck on "Pending" indefinitely).
    - The resulting filename in your vault is **valid and non-empty** — no raw `/` or
      `:` characters broke the file path, and Obsidian did not reject the filename.
    - The note's frontmatter `title:` field displays the full original title text
      (including the `#`, `[`, `]` characters, which are legal in filenames and are not
      stripped — only `/` and `:` are).

### Step E: manual "Save to Obsidian" for a past meeting

18. On the meetings page, find any meeting already in the "Last 10 meetings" table
    (doesn't need to be the most recent one).
19. Click its **"Save to Obsidian"** button (in the actions column, next to the
    download/webhook/delete buttons).
20. Confirm the button shows "Sending…" briefly, then Chrome shows the "Open
    Obsidian?" prompt (or opens Obsidian directly if already allowed), and the note is
    created in the vault exactly as described in Step B.
21. Confirm this works even when **"Automatically save transcript to Obsidian, after
    each meeting"** is turned **off** — the manual button should work independent of
    the auto-save toggle. If the vault name field was cleared, confirm you instead get
    an alert asking you to configure a vault name first, and no tab/prompt opens.

### Record results here

| Step | Date | Pass/Fail | Notes |
|---|---|---|---|
| A (settings UI) | 2026-08-26 | Pass | |
| B (end-to-end auto-save) | 2026-08-26 | Pass | First attempt failed because the unpacked extension hadn't been reloaded after Phase 2/3 changes; passed after reload. |
| C ("Always allow" suppresses prompt) | | | Not separately confirmed |
| D (special characters in title) | | | Not separately confirmed |
| E (manual "Save to Obsidian") | | | Not separately confirmed |

---

## Known limitations to keep in mind while testing (by design, not bugs)

- `obsidian://` has no delivery callback. "Sent" / the "Obsidian status: Sent" label
  only means the extension successfully launched the handoff (and, for large notes,
  copied to the clipboard) — it is never proof the `.md` file exists in your vault.
  Always visually confirm the note in Obsidian itself.
- The destination folder must already exist in the vault; TranscripTonic does not
  create folders.
- The vault name must match Obsidian's vault switcher exactly, including case.
- For a long transcript, the note is delivered via the OS clipboard instead of being
  embedded directly in the `obsidian://` URI (there is a conservative length threshold
  in `extension/obsidian/uri.js`). If the new note in Obsidian opens with an empty
  body, paste with Cmd/Ctrl+V — the handoff page's status text will tell you when this
  path was taken.
- The "Open Obsidian?" prompt is tab-modal. Closing the handoff tab before answering it
  dismisses the prompt without opening Obsidian.

---

## Phase 4 — Local LLM summary enrichment manual verification

Requires everything from Phase 3 already configured and working (vault name, folder,
filename template), plus a local LLM server reachable from this machine: either
[LM Studio](https://lmstudio.ai/) with its local server started (default
`http://localhost:1234/v1/chat/completions`) or [Ollama](https://ollama.com/) serving
its OpenAI-compatible endpoint (typically `http://localhost:11434/v1/chat/completions`).
Pull/load at least one instruct-tuned model in whichever server you use before starting.

**Reload the unpacked extension in `chrome://extensions` first** if you had it loaded
from before this round of changes (Phase 4 added new files/settings).

### Step A: configure and enable the LLM setting (permission-grant gesture)

1. Open the meetings page (`meetings.html`) and scroll to **"Local LLM summary
   enrichment"** (below the Obsidian section).
2. In **Endpoint URL**, enter your server's chat-completions endpoint — the LM Studio
   default is pre-filled as a placeholder; for Ollama use
   `http://localhost:11434/v1/chat/completions` instead.
3. In **Model name**, enter the exact model identifier as known to your local server
   (e.g. what `ollama list` shows, or the model dropdown in LM Studio's server tab).
4. Leave **Timeout** at the default (90000 ms) or lower it for testing.
5. Click **Save** — confirm an alert says "LLM settings saved!".
6. Click the **"Enable local LLM summary enrichment"** checkbox.
   - Confirm this is the action that triggers Chrome's permission prompt (an
     "<extension> wants to access data on `<host>`" style prompt, or similar) — this
     must happen directly from clicking the checkbox, not from unrelated navigation.
   - Click **Allow**. Confirm the checkbox stays checked afterward.
7. Reload `meetings.html` (or revisit it later) and confirm the checkbox still shows
   checked — the granted permission plus `obsidianUseLlm: true` should both persist.
8. As a negative check: open `chrome://extensions` → TranscripTonic → "Details", find
   the granted host permission for your endpoint's host, and remove it. Reload
   `meetings.html` — confirm the checkbox now shows **unchecked** (the UI must never
   claim the feature is "on" without the matching permission actually being granted).
   Re-grant it via the checkbox again before continuing.

### Step B: end-to-end note with the local server running

9. Make sure **"Automatically save transcript to Obsidian, after each meeting"** is on
   (from Phase 3) and the LLM checkbox from Step A is on, with your local LLM server
   running and warmed up (send it one throwaway request first if it's a cold start, to
   keep the real test within the timeout).
10. Join a real Google Meet call, enable captions, have an actual back-and-forth
    conversation for a few minutes (so the model has real content to summarize).
    Include, deliberately:
    - At least one clear action item and one decision, stated early — within the first
      30-60 seconds of the call — so you can check its timestamp citation renders as
      `[0:00]`-ish rather than being dropped.
    - One open question left unresolved.
    - One item that is vague/paraphrased/hard to pin to a single moment (e.g. a point
      made gradually over a stretch of back-and-forth, not a single clean statement) —
      so you can check it renders with **no bracket** rather than a guessed timestamp.
    - Note down (or remember) roughly when things were said, so you can spot-check
      timestamps afterward.
11. End the call.
12. On the meetings page, confirm the **"Summary"** column for this meeting now shows a
    **"View summary"** disclosure once generated — click it to expand and read the
    cached summary text.
13. Open the actual note that landed in your Obsidian vault (same vault/folder/filename
    behavior as Phase 3) and confirm:
    - Only the sections the model actually returned are present — if it returned no
      `topics`, there is no "Topics" heading at all (not an empty one); same for any
      other empty/omitted field. There is **no `## Summary` heading anywhere** — it has
      been replaced by `## Key Takeaways`.
    - Section order (when present) is: Action items, Decisions made, Open questions,
      Next steps, Key Takeaways, Topics — appearing after the frontmatter/title and
      before `## Transcript`.
    - Timestamp citations (the `[M:SS]`/`[H:MM:SS]` suffix on action items, decisions,
      open questions, next steps, and topic points) are plausible against your own
      memory of when things were said — spot-check 2-3 against the notes/memory from
      step 10.
    - The item you deliberately stated near the start of the call renders a
      `[0:00]`-ish timestamp rather than being dropped entirely.
    - The item you deliberately made vague/unattributable renders with **no bracket**
      at all, rather than a guessed/fabricated timestamp.
    - `## Key Takeaways` bullets show correctly-formed `**bold**` lead-ins (e.g.
      `- **Lead:** Detail.`) — not a missing or broken opening `**`.
    - Action items **never** show an owner or due-date suffix (that metadata was
      removed from the schema entirely) — just the task text and an optional
      `[M:SS]` timestamp.
    - The raw `## Transcript` section (and `## Chat messages`, if you used chat) is
      still present and complete, unaffected by the summary being added above it.

### Step C: graceful fallback when the local server is unreachable

14. Stop your local LLM server (quit LM Studio's server / `ollama stop` or kill the
    Ollama server process), OR leave it running but change **Endpoint URL** to an
    invalid/unreachable address (e.g. `http://localhost:1/v1/chat/completions`), OR set
    **Timeout** to a very low value (e.g. `50`) so a real server can't respond in time.
    Save the settings.
15. Join another short real Meet call, enable captions, talk briefly, end the call.
16. Confirm the overall export flow does **not hang** — the handoff tab's status
    updates past "Summarizing with local LLM…" within roughly your configured timeout
    (or immediately, if the endpoint is simply unreachable) and reaches "Opening
    Obsidian…" / "Done" normally.
17. Confirm **no error dialog or broken UI state blocks the flow** — at most the status
    line mentions the local LLM being unavailable, and the handoff still proceeds.
18. Confirm the note still lands in Obsidian exactly as in Phase 3 (plain transcript,
    correct frontmatter/filename), with **none** of the LLM-generated sections present
    at all — no "Action items", "Decisions made", "Open questions", "Next steps", "Key
    Takeaways", or "Topics" headings — i.e. this behaves identically to Phase 3 with the
    LLM feature off.
19. Confirm the meetings page's **"Summary"** column for this second meeting shows "—"
    (no cached summary), not a stuck/broken state.
20. Restore your endpoint/timeout settings back to their working values when done.

### Record results here

| Step | Date | Pass/Fail | Notes |
|---|---|---|---|
| A (enable + permission grant) | 2026-08-26 | Pass | |
| B (end-to-end note with real server) | 2026-08-26 | Pass | Verified against the pre-redesign schema (Summary/Key topics/owner-dueDate action items). Needs re-verification against the new timestamped-sections schema — see updated Step B checklist above. |
| C (graceful fallback, server down/unreachable) | 2026-08-26 | Pass | |

---

## Phase 5 — Full UI rewrite manual verification

Vite + CRXJS + React + TypeScript + Tailwind + shadcn/ui (on Base UI) now build the
popup, the history page (`meetings.html`, moved to the repo root — see `PLAN.md` §6
Phase 5 for why), and the Obsidian handoff page (`extension/obsidian/handoff.html`,
still at the same path, now a React shell). The side panel
(`extension/side-panel/index.html` + `side-panel.js`) and the in-meeting FAB
(`extension/content-scripts/**`) were intentionally left exactly as upstream shipped
them — see "What was NOT rebuilt" below.

Automated checks already run by the implementing session (not a substitute for the
steps below, which require a human): `npm run build` succeeds; `dist/content-scripts/**`
is byte-identical to `extension/content-scripts/**` (verified with `diff -rq`); `npm
test` (77/77 tests, unmodified); `npm run typecheck` shows only pre-existing upstream
errors (documented in this file's history — see the Phase 2 entries — none of the new
`src/**/*.tsx` code adds any).

### Step A: load the built extension

1. Run `npm install` then `npm run build` from the repo root.
2. Load `dist/` unpacked per "Before you start" above.
3. Open `chrome://extensions`, confirm **zero errors** are shown for the extension
   (click "Errors" if the button appears — it should not).
4. Click the extension icon to open the **popup**. Confirm:
   - It renders correctly (TranscripTonic heading, icon, platform checkboxes, auto/manual
     mode radio buttons, hide-captions checkbox, webhook blurb, footer links, version
     number).
   - Open the browser DevTools console for the popup (right-click the popup → Inspect)
     and confirm there are **no console errors**.
5. Click "Last 10 meetings" (or open `chrome-extension://<id>/meetings.html` directly).
   Confirm the **history page** renders (meetings table, Obsidian settings, LLM
   settings, webhook settings/help) with **no console errors**.

### Step B: re-run the Phase 3 checklist against the new UI

6. Repeat **Phase 3, Steps A-E** above in full, using the popup/history page you just
   loaded from `dist/`. Everything there (vault name/folder/filename template form,
   auto-save checkbox, the meetings table's Obsidian status column and "Save to
   Obsidian" button, special-character title handling) should work identically to
   before — confirm no regressions.

### Step C: re-run the Phase 4 checklist against the new UI

7. Repeat **Phase 4, Steps A-C** above in full. Pay particular attention to Step A.6 —
   the permission-request prompt must still fire directly from clicking the "Enable
   local LLM summary enrichment" checkbox (a real user gesture) even though that
   checkbox is now a Base UI `Checkbox` component, not a native `<input type=checkbox>`.
8. Confirm the "View summary" disclosure on a meeting row (now a Base UI `Collapsible`)
   expands/collapses correctly and shows the cached summary text.

### Step D: Obsidian handoff page — status stepper

9. Trigger a handoff (either a real meeting with auto-save on, or "Save to Obsidian" on
   a past meeting). The handoff tab should open `extension/obsidian/handoff.html` and
   show a **step list** (Load meeting → Summarize with local LLM → Build note → Copy to
   clipboard → Open Obsidian), each with a status pill (Pending/Working…/Done/
   Skipped/Failed).
10. Confirm steps update live as the flow progresses, and that whichever steps don't
    apply (e.g. "Summarize with local LLM" when the LLM feature is off, or "Copy to
    clipboard" for a short note that goes inline) show **Skipped**, not stuck on
    Pending.
11. Confirm the **"Close this tab" button is present the entire time and is never
    auto-triggered** — if Chrome shows the "Open Obsidian?" prompt, it must still be
    sitting there waiting for you; closing the tab yourself before answering it should
    dismiss the prompt (this is expected/by-design, not a bug — see "Known limitations"
    above).
12. Force a failure path (e.g. clear the vault name first, or trigger two handoffs back
    to back to hit the clipboard lock) and confirm the relevant step shows **Failed**
    with a short explanatory detail, and the final message below the steps explains
    what happened — no blank/frozen page.
12a. **Clipboard-copy-while-unfocused fix.** With a note large enough to trigger
    clipboard delivery mode (i.e. the "Copy to clipboard" step is not Skipped), trigger
    a handoff and immediately click away to another window/app so the new handoff tab
    is *not* the focused window when the copy would normally happen. Confirm the note
    still ends up on the clipboard (paste it somewhere to check) and the "Copy to
    clipboard" step still shows **Done** — this exercises the window-focus-forcing +
    `execCommand("copy")` fallback added to fix the
    `[obsidian-handoff] clipboard write failed [object DOMException]` bug. Then open
    `chrome://extensions` (or `edge://extensions`), find the TranscripTonic card, and
    click **Errors** — confirm no new errors were logged for this run.

### Step E: Base UI primitives — keyboard nav and focus behavior

The whole point of building on Base UI (not Radix) is that these interactive primitives
actually work correctly — verify by hand, not just by reading the code:

13. On the history page, **Tab** to the "Enable local LLM summary enrichment" checkbox
    (or any checkbox) without touching the mouse. Confirm it shows a visible focus ring,
    and pressing **Space** toggles it.
14. **Tab** to the webhook body type radio group (Simple/Advanced). Confirm the
    **arrow keys** move selection between the two options and Tab moves focus into/out
    of the group as a whole (not stopping on each radio individually) — standard radio
    group keyboard behavior.
15. Open the delete-confirmation flow for a meeting row (or any other native `confirm()`
    dialog used in the row actions) and confirm it still works — these intentionally
    stayed as native `confirm()`/`alert()` rather than being rebuilt as a Base UI
    `Dialog` (see "Deviations" below).
16. Expand a "View summary" or "Webhook body" `Collapsible` using only the keyboard
    (Tab to it, press **Enter** or **Space**). Confirm it expands/collapses and that
    focus stays sensible (doesn't jump away or get lost).
17. With your browser DevTools open, inspect the DOM of the rendered Checkbox/
    Collapsible/RadioGroup elements. Confirm the markup uses **Base UI's** own data
    attributes/structure (e.g. elements and attributes referencing `base-ui`, not
    `radix`) — this is a final sanity check that the `shadcn` install actually landed on
    the Base UI backend as required, not Radix.

### What was NOT rebuilt in React (and why)

- **Side panel** (`extension/side-panel/index.html` + `side-panel.js`): carried over
  from upstream completely unmodified — not even its build path changed conceptually
  (it's still bundled by CRXJS since it's manifest-declared, but the source is byte-for-
  byte what upstream shipped). This was a deliberate time/complexity trade-off allowed
  by `PLAN.md` §6 Phase 5 build-sequencing step 7 ("Side panel, only if time allows,
  otherwise carry over upstream's as-is"). If you notice anything different about its
  behavior versus pre-Phase-5, that would be a real regression worth flagging — but none
  is expected, since the file is untouched.
- **In-meeting FAB** (drawn by `extension/content-scripts/common-utils.js`): left
  entirely as-is, not even a CSS reskin. `extension/content-scripts/**` had to stay
  byte-identical to `dist/content-scripts/**` for the Phase 5 Definition of Done (it's
  copied verbatim, not processed by Vite, since it's registered at runtime via
  `chrome.scripting.registerContentScripts()` rather than declared in the manifest) —
  touching it for a cosmetic reskin wasn't worth trading away that guarantee. Confirm
  the FAB still looks and behaves exactly as it did pre-Phase-5 during your Phase 1/3/4
  re-verification above.

### Record results here

| Step | Date | Pass/Fail | Notes |
|---|---|---|---|
| A (load dist/, popup + history page render, no console errors) | | | |
| B (Phase 3 checklist re-run against new UI) | | | |
| C (Phase 4 checklist re-run against new UI) | | | |
| D (Obsidian handoff status stepper) | | | |
| D2 (clipboard copy while handoff tab unfocused + no new errors console) | 2026-08-26 | Pass | Rebuilt, reloaded unpacked from `dist/`, retested end-to-end. |
| E (Base UI keyboard nav / focus / DOM inspection) | | | |
