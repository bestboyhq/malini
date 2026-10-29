# 0111 - Your turn is blue, and amber means a problem

Status: accepted

## Context

Every "needs you" drew in the warning amber that also marks real problems: the sidebar's icons and dots, the started-workstream rows with an alert glyph, the decision card, Your decisions, the Jobs badge and the focus strip's dot (0090).
On a lead chat, `leadHeadline` gave the top bar the pull request zone's `needs-you` tone for any question, so a decision drew the hazard stripes and amber buttons of a stuck merge.
The user said: "the whole pull request bar ... goes yellow like there is some pull request error and that's incorrect", "I feel like the whole UI is screaming on me", and "It's not a problem. It's like a decision to make."
Their eye went to the top right before the decision card at the bottom of the chat.
Of three variants rendered on a real lead with a waiting decision (quiet, blue, card first), they picked blue.
Malini already marked an open `Needs:` as **Your turn** on `bg-brand/10` in `TurnReportCard.svelte` and `VariantPickForm.svelte`.

## Decision

- A question, a decision or an approval that waits on you draws in brand blue: `text-brand-icon` or `bg-brand-icon` for marks, `text-brand-foreground` for words, `bg-brand/10` for a tile, and `bg-brand` with `text-brand-content` for a count badge.
- Amber (`warning`) is only for a problem: a merge Malini stopped (`PullRequestPhase` `needs-you`), a lost GitHub connection, stale data, risky access.
  Red stays a failure.
- The `dot` glyph in `packages/hyper-ui/src/icons/glyphs/dot.svg` replaces the warning `alert` wherever something asks you; approvals keep `shield-alert`, in blue.
- `progressDot` in `src/lib/app/domain/lead-progress.ts` tells `blocked` (a started workstream whose merge stopped, amber) from `needs` (it asks you, blue); both count as "need you" in every label and file under **Needs you**.
- `leadHeadline` gives the top bar `asks` when only questions wait, and `needs-you` only for a blocked merge or a failed run.
  `TopBar.svelte` draws `asks` as `idle`, with only its detail in `--color-brand-foreground`.
- A running progress dot is neutral (`text-fg-secondary bg-current`, pulsing), and so is the **In progress** section icon, so blue only ever means your turn.

## Consequences

- A lead with an open decision reads calm: the decision card is the only thing that asks, and nothing on screen looks like an error.
- A stuck merge or a failed run still stands out, since amber and red no longer cry wolf.
- Blue now carries two meanings that stay apart by shape: a filled dot or a tinted tile is your turn, a moving dot or a highlighted route in the Jobs map is activity.
- A new surface that waits on you must use the brand tokens, never `warning`; nothing lints that, since colors are design tokens and Rule 3 keeps them out of tests.
- Enforced by `lead-progress.test.ts` (a blocked merge is `blocked`, a question heads the top bar as `asks`, a blocked merge or a failure as `needs-you`), `sidebar-sections.test.ts` (a blocked merge files under **Needs you**) and `pnpm check` (`GlobalTopBarZoneTone` and every `ProgressDot` map stay exhaustive).
