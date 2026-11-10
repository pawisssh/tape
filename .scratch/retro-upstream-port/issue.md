# Retro: guardrails and upstream-sync record after the Meet captions port

Retro on porting upstream transcriptonic v3.4.4/v3.4.5 + ac67edc (PR #7). These are environment fixes, not product changes.

1. **No guardrail runs the checks.** There's no `.github/workflows` and no pre-commit hook, so PR #7 reported 0 checks even though `npm test`, `npm run typecheck` and `npm run build` all exist.
   Fix: a GitHub Actions workflow that runs all three on every PR and on every push to `main`.

2. **No record of upstream sync decisions.** Hand-ported commits never merge, so `git log main..upstream/main` will keep listing commits that were already ported or ruled out (e.g. aa0a1f9, FAB lag, not applicable). PLAN.md still names v3.4.2 as the base.
   Fix:
   - an `UPSTREAM.md` ledger listing each upstream commit with its decision (ported / skipped / n/a) and the reason
   - a script that lists upstream commits missing from the ledger
   - an AGENTS.md pointer to the ledger

3. **Teams host list is duplicated** between `extension/background-script/config.js` and `manifest.config.ts`, and only a "keep in sync" comment ties them together. If one side drifts, the permission request fails or the FAB icons don't load on that host.
   Fix: a test asserting that every `PLATFORM_CONFIGS[*].matches` origin is in the manifest's `host_permissions` or `optional_host_permissions`, and in the `web_accessible_resources` matches.

4. **Auto mode doesn't log the captions toggle it found.** The open question from PR #7 is whether Meet's `translate_cc` button carries `aria-pressed`, but only the Start capture press logs the toggle state.
   Fix: have auto-enable log the icon ligature and its `aria-pressed` once, so a live Meet console answers the question.
