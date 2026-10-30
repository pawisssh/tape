# Tape

A browser extension that captures meeting captions from Google Meet, Teams and Zoom and turns each meeting into a saved transcript, optionally summarised and handed to Obsidian.

## Meeting lifecycle

**Meeting**:
One captured call, saved to the meetings list with its transcript, chat messages and notes once it has been finalized.
_Avoid_: Call, session, recording

**Live meeting**:
The meeting currently being captured in a tab, before it has been finalized. At most one exists at a time.
_Avoid_: Current meeting, active session

**Meeting tab**:
The browser tab whose live meeting is being captured. While the live meeting is being finalized, there is no meeting tab, only a processing state.
_Avoid_: Capture tab

**Finalize**:
To turn a live meeting into a saved Meeting, exactly once. Exporting, webhook posting and the Obsidian handoff happen after finalization; they are not part of it.
_Avoid_: Process, save, pick up, end

**Finalized marker**:
The record of which live meeting was last finalized, so the same live meeting is never finalized twice, even after the user deletes or imports Meetings.
_Avoid_: Last meeting check

**Recovery**:
Finalizing a live meeting whose finalization never ran or was interrupted: after a browser crash, or when its tab reloads or another meeting is joined before it ended.
_Avoid_: Restore, resume
