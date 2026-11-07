# 0174 - Turns before the last two fold their work

Status: accepted

## Context

Every finished turn kept its whole work path in the transcript: thoughts, interim messages, activity groups and subagents.
In the user's own chat one older turn stood 4,823 px tall in 116 rows above its answer, and the transcript window (0024) mounted and unmounted those rows as the user scrolled.
The user asked for it: "user wants to only have quick access to the current and previous round, and all past rounds should be autocollapsed (i mean tool calls and reasoning path etc)", since the rest "impacts performance and a ton of other things".

## Decision

- `foldsWork(runs, index)` in `timeline-derivations.svelte.ts` folds every finished run before the last `UNFOLDED_ROUNDS`, two.
- `foldRunWork` in `activity-group.ts` keeps the prompt, the started workstreams card and the run's last assistant message, and puts every other row in one `work-fold` row, in order; a run with fewer than `ACTIVITY_GROUP_MIN_ITEMS` such rows stays as it is.
- The fold's line reuses the activity group's words over all its tool calls, such as "Edited build.mjs, ran 79 commands", and "Worked N steps" when it holds none.
- `RunWorkFold.svelte` mounts nothing inside until it is opened, and its open state persists in `expandedActivityGroups`; open, each row is a `TranscriptRow`, and the "Show older events" button moves inside it.
- `estimateRunHeight` sizes a folded run as its prompt, the line and its answer, so the placeholders of runs out of view match what mounts.

## Consequences

- An older turn mounts three rows, so a long chat scrolls and opens on far fewer nodes: at the same spot in the user's chat, 4 rows mounted instead of 52.
- A turn folds the moment the user sends the second prompt after it, above the view, where the scroll anchor keeps the reader still.
- `transcript-round-fold.spec.ts` checks that older turns show one line with the prompt and the answer, that opening it shows the steps, and that a third newer turn folds the one before it; `activity-group.test.ts` checks what folds and the line it reads.
