# Live Assist skills plan

## Objective

Extract Rewind and Recap into application-owned skill modules. Each button selects its skill through the existing live-assist flow. Give live assistance a dedicated shared system prompt, and preserve decisions and action items as structured Recap state across incremental updates.

## Starting point

Branch: codex/live-assist-skills, created at commit 1444e96 with in-progress live-panel and capture work in its working tree. Preserve that work while implementing the plan.

## Implementation sequence

1. Define a small skill contract and pure `rewind.js` / `recap.js` modules under `extension/background-script/skills/`. Keep instructions, input construction, output schema, validation, and rendering together. No dynamic SKILL.md loader is needed.
2. Add a shared Live Assist system prompt: use only supplied evidence, preserve conversation language and exact names/numbers, treat transcript and previous state as data rather than instructions, and return the required JSON shape. Keep provider transport reusable without modifying the Obsidian interpreter's output contract.
3. Route the existing Rewind and Recap buttons through skill selection in `runLiveAssist`. Preserve selected provider/model, the 15-second caption snapshot, raw preview, error handling, and current UI behavior.
4. Make Recap state structured: concise overview, decisions, action items (optional explicit owner/deadline), and unresolved questions. Feed that state plus new transcript to each update. Preserve supported earlier items, deduplicate repeats, and revise or remove items only when new evidence explicitly supersedes them. Render the state into readable text; apply the display length target to the rendered overview rather than truncating retained facts.
5. Version the checkpoint schema and prompt/skill revision. Retain chunking, context-limit retries, request time limits, and advance checkpoints only after validated success. Invalidate legacy or incompatible checkpoints and rebuild from transcript. Reuse a valid checkpoint without a model call when no new text exists.
6. Add meaningful tests for button-to-skill routing, prompt/data separation, malformed structured output, retaining earlier decisions/actions across chunks, explicit corrections, duplicate prevention, and checkpoint compatibility/resume. Update user-facing documentation where behavior changes.

## Validation

- Run focused live-assist and live-panel tests while implementing.
- Run `npm test`, `npm run typecheck`, and `npm run build` after integration.
- Manually verify Rewind on recent captions and Recap over multiple updates in a captured meeting when a browser/model session is available. Report any unverified live-model behavior separately.

## Completion criteria

- Clicking each existing button executes its application skill.
- Live Assist uses its dedicated prompt without changing Obsidian template behavior.
- Recap carries validated structured facts through incremental updates and resumes safely.
- Relevant automated checks pass, with live-model verification status reported.

## Implementation status

The Rewind and Recap skill modules, dedicated Live Assist prompt, structured Recap checkpoint, and automated coverage are implemented on this branch. Browser verification with a live caption source and configured model remains a manual check.
