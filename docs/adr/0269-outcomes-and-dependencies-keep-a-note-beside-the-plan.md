# 0269 - Outcomes and dependencies keep a note beside the plan

Status: accepted

## Context

0268 put a repository's plan beside its scratchpad, with each outcome folded until a click opened it.
A day after it shipped the user asked for changes: "the outcome should be always expanded", folding "should be like a dedicated icon button maybe at the end of the row because it's not a default thing", and a click on an outcome or a dependency "should put me in text edit mode".
The scratchpad was "uncontextualized ... a dump of thoughts", and they wanted "a contextualized note" on an outcome that "shouldn't be on the task list", plus "a small contextualized editor on the right" for a focused dependency.
They also asked for "just an icon button" in place of the **Start workstream** button.
Of three prototypes, the pane that follows the selected row, one document with a section per outcome, and a note docked under the scratchpad, they picked the first, with "less borders" and a look "like our settings page".
This amends 0268.

## Decision

- `initiatives` and `initiative_dependencies` each get a `note TEXT` column, null while the note is blank.
  A note is a scratchpad document, the same TipTap JSON the `scratchpads` table keeps.
- `Initiative` and `InitiativeDependency` in `src/contract/initiatives.ts` carry `note`, and `initiatives.update` and `initiatives.update-dependency` take `note`, a document or null.
  The main process checks it with `isScratchpadContent` from `scratchpad.platform.ts` and `SCRATCHPAD_CONTENT_MAX_LENGTH`.
  There is no new command and no new event.
- A click on a row selects it, and `RepositoryPage.svelte` keeps the selection for the repository it was made on.
  `InitiativeNotes.svelte` fills the right pane: the scratchpad with no selection, the selected row's note otherwise.
  Above a note sit a path back, **Scratchpad** then the outcome for a dependency, the row's title, and "Dependency of" its outcome or the outcome's day.
- The note is edited in `ScratchpadEditor.svelte`, which `scratchpad.api.ts` now exports.
  With `onstart` null it moves no paragraph into a workstream and does not take focus when it opens, so the title being edited keeps it.
- An outcome shows its dependencies from the start.
  An icon button at the row's end hides and shows them, named `Dependencies of <outcome>` with `aria-expanded`, and what is hidden is kept in memory only.
- A click on a title edits it in place with the caret where the click landed, through `document.caretPositionFromPoint`.
  **Rename** in the row's menu and the keyboard select the whole title.
  Enter and a click elsewhere save, Escape drops the edit.
- **Start workstream** is an icon button with that tooltip, shown on hover and focus.
- A row with a note shows a note glyph named "Has a note".
- The right pane keeps the rule on its left, and the weeks of the rail keep the rule above their labels.

## Consequences

- A thought about one outcome or one dependency has a place of its own, and the scratchpad stays for the ones that belong to none.
- The scratchpad is out of view while a row is selected; **Scratchpad** in the path brings it back.
- A note is deleted with its outcome or dependency, by the cascade 0268 set up.
- Every command still returns the whole list, so each edit of a note sends every note back to the renderer.
  That is fine at tens of outcomes on one Mac; a plan with long notes on hundreds would need a command that returns nothing.
- A hidden outcome opens again after a reload.
- Enforced by `apps/malini/src/lib/initiatives/platform/register.test.ts` (a note is kept, cleared and refused when it is no document), `apps/malini/src/lib/initiatives/domain/initiative.test.ts` (`noteTarget`), and `apps/malini/tests/e2e/initiatives.spec.ts` (hide and show, a click that edits a title, a note on an outcome and on a dependency, and the path back to the scratchpad).
