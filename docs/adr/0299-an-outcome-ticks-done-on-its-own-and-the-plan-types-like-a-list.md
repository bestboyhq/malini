# 0299 - An outcome ticks done on its own, and the plan types like a list

Status: accepted

## Context

0268 made an initiative finished only once it has dependencies and all of them are done, and drew a progress ring beside each outcome.
The ring looked like a checkbox but was not one: in the Plan widget a click did nothing, and on the repository page it only selected the row.
An outcome with no dependencies could never finish.
Return in **Name an outcome** moved the focus to **Add a dependency** under the new outcome, so the next title typed became a dependency.
On the repository page a day lost its **Name an outcome** field once it had an outcome, the arrow that folds dependencies showed on outcomes that had none, and Escape in a field left the focus nowhere.
Simon: "I'm adding an outcome. And then there is like a circle. I cannot click. Enter is weird like almost all the interactions are weird and I'm basically getting lost as a user trying to figure out what is happening."

## Decision

- `initiatives` gets `done INTEGER NOT NULL DEFAULT 0`, user_version 119, and `Initiative` carries it as `done`.
  `initiatives.update` takes `done`, a boolean, beside `title`, `dueOn` and `note`.
- An outcome is finished when its `done` flag is set, or when it has dependencies and all of them are done, through `initiativeFinished` in `domain/initiative.ts`.
  This amends 0268's rule, which keeps holding for an outcome nobody ticked.
- The circle beside an outcome is a checkbox named after it, `OutcomeCheck.svelte`, in the widget and on the page.
  A click sets or clears the flag.
  When every dependency is done, the circle is a full ring named **Done** that no click changes, since clearing the flag would leave it finished.
  A finished outcome's title is struck through, as a done dependency's is.
- `plan.json` carries `done` on each outcome, merged field by field like `title` and `dueOn` (0293).
  A changed tick commits as `Close <title>` or `Reopen <title>`, and a teammate's shows as closed or reopened, as a dependency's does.
  A file from an older Malini without the field reads as not done.
- Return in **Name an outcome** adds the outcome and keeps the focus in that empty field, so a list of outcomes types like a list.
- Dependencies are added only from the **+** on an outcome's row, which opens the field under it.
  Return there adds each dependency and keeps the field; Escape, or leaving it empty, closes it and puts the focus back on the outcome's title.
- On the page, every day keeps its **Name an outcome** field after its outcomes, shown only on hover or focus once the day has one.
- The fold arrow shows only on an outcome with dependencies.
- ArrowUp and ArrowDown move between the titles of the plan's outcomes and dependencies, from `stepTitle` in `title-caret.ts`; Alt with them still moves an outcome a day (0268).
- Ticking a dependency on the page no longer selects its row.

## Consequences

- An outcome can be finished by hand without inventing a dependency, and a ticked outcome past its day leaves **Earlier** like one finished by its dependencies.
- A tick on an outcome is now shared plan state, so it syncs, merges and shows in the plan repository's history like every other field.
- A dependency can no longer be added straight from **Name an outcome**; it takes one click on **+**.
- Enforced by `src/lib/initiatives/domain/initiative.test.ts` (`initiativeFinished`, and a ticked outcome leaves **Earlier**), `src/lib/initiatives/platform/register.test.ts` (the tick round trip and its validation), `src/lib/initiatives/platform/plan-file.test.ts` (writing, reading and merging `done`, and the `Close` and `Reopen` commit lines), `src/lib/initiatives/platform/plan-sync.test.ts` (a tick crosses two Malinis on a real bare remote both ways, and an older file reads as not done), `src/main/db/migrations.test.ts`, and `tests/e2e/initiatives.spec.ts`, where the built app types two outcomes with Return, ticks and unticks the circle on the page and in the Plan widget, adds dependencies from **+** until Escape, and moves with the arrows.
