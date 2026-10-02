# Live Assist next iteration

## Starting point

This branch starts at the locally merged main commit ccaba8b. Rewind and Recap already have separate application-owned skill modules, a shared prompt, validated JSON output, progressive Recap checkpoints, and UI buttons. Do not rebuild that architecture.

## Objective

Make Recap facts easier to reconcile across long meetings and easier to verify against what was actually said. Keep Rewind's 15-second behavior and the normal final meeting summary intact.

## Plan

1. Define stable, app-assigned IDs for decisions, action items, and unresolved questions. Each fact should retain a short evidence quote and a stable transcript position or source offset. Keep the display text separate from identity and provenance.
2. Extend the Recap skill output so the model can propose a new fact, refer to an existing fact ID as a duplicate, or explicitly supersede an ID with a correction. Treat transcript text and previous state as untrusted data. Validate IDs, output shape, and evidence against the new transcript before accepting changes.
3. Merge candidates deterministically: preserve earlier facts when a later chunk omits them, avoid duplicate facts expressed with different wording, and apply corrections only when the new excerpt supports them. A model error or malformed response must not advance the checkpoint.
4. Version the revised state and checkpoint format. Rebuild safely from transcript when loading an older or incompatible checkpoint. Keep chunk-size retries, timeout behavior, no-new-text reuse, and selected provider/model behavior.
5. Test repeated and paraphrased facts, explicit corrections, unsupported removals, malformed output, checkpoint migration and resume, and prompt-injection text inside captions. Run the full test, typecheck, and build checks.
6. Verify Rewind and multiple Recap updates in a captured meeting with a configured model when one is available. Record provider/model and any behavior that remains unverified.

## Completion criteria

- A fact appears once across repeated or paraphrased chunks, with evidence that points back to the transcript.
- Earlier supported facts remain visible; a correction updates the intended fact without removing unrelated facts.
- Interrupted and resumed Recap runs produce the same retained facts as a continuous run.
- Existing Rewind, Notes, exports, Obsidian summary, and final meeting behavior continue to pass regression checks.

## Current scope

The next task scope is confirmed: add stable fact IDs and transcript references to Recap. This document prepares the branch; implementation has not started.
