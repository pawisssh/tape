# Upstream sync ledger

Tape forked `vivek-nexus/transcriptonic` at v3.4.2 (`d9be648`). Since then, upstream changes have been ported by hand rather than merged, because Tape's content scripts have diverged too far for upstream's commits to apply. A hand-port never merges the upstream commit, so `git log main..upstream/main` keeps listing commits that are already handled. This ledger records the decision for each one instead.

To see what's left to review, run `npm run upstream:pending`. It fetches `upstream` and lists every non-merge commit since the fork point that has no row below.

Decisions:
- **ported**: the change is in Tape. Name the Tape commit or PR.
- **skipped**: the change applies, but Tape doesn't want it.
- **n/a**: the code it touches doesn't exist in Tape, or works differently there.

| Upstream | Subject | Decision | Notes |
|---|---|---|---|
| `ac67edc` | fix(teams): match Defender for Cloud Apps proxy hosts | ported | PR #7. Tape also adds the hosts to `web_accessible_resources` for the FAB icons. |
| `c91e9c0` | Bump version | skipped | Tape versions itself. |
| `aa0a1f9` | Fix FAB lag | n/a | Upstream stopped repainting the FAB on every transcript storage write. Tape's FAB only listens for `meetingStartTimestamp`. |
| `a1dea62` | Handle new translate + captions icon in Google Meet | ported | PR #7. Its Teams shortcut refactor became the shared `dispatchKeyboardShortcut`. Upstream's manual-mode banner move was skipped, because the FAB's play state covers it. |
| `c1229b6` | Retry Google Meet captions shortcut until captions are on | ported | PR #7, adapted to `readCaptionsToggleGoogleMeet`, plus a single-loop guard. |
| `744c59b` | Tweak for release | ported | PR #7. Never sends "c" while the toggle state is unknown. Its version bump and zip were skipped. |
