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

## Phase 4 — Local LLM summary enrichment (not yet implemented)

Not started. This section will be filled in once Phase 4 is implemented and handed
back for manual verification.

## Phase 5 — Full UI rewrite (not yet implemented)

Not started.
