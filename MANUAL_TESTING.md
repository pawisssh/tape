# Manual testing checklist

This file is the human-run verification gate referenced in `PLAN.md`. No automated
session can complete these steps — they require a real Google Meet call, a real
Obsidian installation, and (for Phase 4, not yet implemented) a real local LLM server.
Run through each phase's checklist in order and record the result (date + pass/fail +
notes) once done.

---

## Before you start: load the extension

1. Open `chrome://extensions`.
2. Enable "Developer mode" (top right).
3. Click "Load unpacked" and select the `extension/` folder in this repo (not the repo
   root).
4. Confirm the extension loads with no errors shown on the extensions page.

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
    conversation for a few minutes (so the model has real content to summarize —
    include at least one clearly stated action item with a named owner and a date, one
    thing that is NOT assigned to anyone, and one open question left unresolved).
11. End the call.
12. On the meetings page, confirm the **"Summary"** column for this meeting now shows a
    **"View summary"** disclosure once generated — click it to expand and read the
    cached summary text.
13. Open the actual note that landed in your Obsidian vault (same vault/folder/filename
    behavior as Phase 3) and confirm:
    - Only the sections the model actually returned are present — if it returned no
      `topics`, there is no "Key topics" heading at all (not an empty one); same for
      any other empty/omitted field.
    - Section order (when present) is: Summary, Key topics, Action items, Decisions,
      Open questions, Next steps — appearing after the frontmatter/title and before
      `## Transcript`.
    - The action item you clearly assigned to a named owner with a date shows that
      owner/date correctly.
    - The action item you deliberately left unassigned does **not** have a fabricated
      owner or due date invented for it.
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
    correct frontmatter/filename), with **no "Summary" sections at all** — i.e. this
    behaves identically to Phase 3 with the LLM feature off.
19. Confirm the meetings page's **"Summary"** column for this second meeting shows "—"
    (no cached summary), not a stuck/broken state.
20. Restore your endpoint/timeout settings back to their working values when done.

### Record results here

| Step | Date | Pass/Fail | Notes |
|---|---|---|---|
| A (enable + permission grant) | 2026-08-26 | Pass | |
| B (end-to-end note with real server) | 2026-08-26 | Pass | |
| C (graceful fallback, server down/unreachable) | 2026-08-26 | Pass | |

---

## Phase 5 — Full UI rewrite (not yet implemented)

Not started.
