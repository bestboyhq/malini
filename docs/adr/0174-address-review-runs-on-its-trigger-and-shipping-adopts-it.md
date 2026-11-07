# 0174 - Address review runs on its trigger, and Shipping adopts it

Status: accepted

## Context

0023 had Shipping request **Address review** on every `changes_requested` it read, and 0086 kept that as handlers: on a draft, Shipping started it once the agent went idle, with no switch to stop it, and in the merge queue it ran when a change request blocked the merge.
Planning read the code as "Address review has no trigger today [...] only the Shipping rule runs it, after you press Merge", and the user asked for a "checkbox: auto address review?" in setup and Settings (0173).
0173 makes each default one built-in's trigger, so a switch that turned the trigger off while Shipping still answered reviews on drafts would lie.
The user's call: Address review is on in Recommended, "It pushes to its own branch and never merges", and "Existing installs keep their current trigger state; only new installs and the defaults step turn it on."
They also asked that it never runs twice with the merge queue, and that this be tested hardest.

## Decision

- **A trigger of its own.**
  The built-in **Address review** has the default trigger `on pull-requests:pull-request-changed where reviewDecision is changes_requested`, On its own, and is triggerable (`TRIGGERABLE_BUILTINS` in `src/lib/automations/domain/builtin-automations.ts`).
  Builtins are seeded insert-only, so an install that had it keeps no trigger until the defaults step or Settings sets one, and Reset restores the default.
- **Shipping adopts what its trigger starts.**
  Before it starts a run, the trigger service asks `ShippingRule.triggered` (`src/lib/pull-requests/platform/ship-rule.ts`), which takes every Address review start for a pull request it tracks.
  It starts the run with Shipping's own review context, the change requests and threads not yet addressed, records it as the workstream's active automation with its attempt and review signature, and settles any review request it had.
  When the run ends, Shipping commits its changes, pushes them to the branch, resolves the threads it names and records the review as addressed, as it does after a run it started itself; it never marks ready or merges.
- **One run per review.**
  `startingAlone` in `ship-store.ts` serializes every start for a workstream, a trigger's and Shipping's own, and a start finds the other's run first.
  The trigger starts nothing while Shipping has an automation running in the workstream, a review was already addressed, its fixes ran out of attempts, the agent works, or the worktree has uncommitted changes or an operation in progress.
  A review it skips that way stays requested in Shipping, which starts it once the agent goes idle.
- **Off means Merge only.**
  While a draft is being worked on, Shipping requests a review only when Address review's trigger is On its own (`reviewsOnItsOwn` in `ship-rule.ts`); with **Ask me first** its trigger's run waits for your yes, and with it off a change request waits until you press Merge; the merge queue still answers any change request that blocks it.
- Change requests are read when Malini reads the pull request: as the pull request bar does, and while shipping waits on GitHub. Malini adds no polling for them.
- This changes 0023 and 0086 only in that a draft's change request starts Address review through its trigger, and only while that trigger is on.

## Consequences

- The setup and Settings switch is the one switch: on, a reviewer's change request on a draft is answered and pushed without a click; off, nothing answers it before Merge.
- An install that finished setup before this stops answering change requests on drafts until you turn Address review on in Settings, Automations, which matches what its trigger always said.
- A change request read while you work is answered once, whichever path sees it first.
- A review that arrives while the workstream has no open pull request bar and no merge waiting is answered only once Malini next reads that pull request.
- Enforced by `src/lib/pull-requests/platform/ship-rule.test.ts` (its trigger's run adopted and pushed once, nothing from the trigger while Shipping addresses the review itself, one run when the trigger and the merge queue both see it, no run after the attempts run out, nothing while it is off), `src/lib/automations/platform/automation-triggers.service.test.ts` (Shipping starts the built-in it takes, the rest start as usual), `src/lib/automations/platform/register.test.ts` (the default trigger) and `tests/e2e/pull-request-blockers.spec.ts` (a change request starts Address review on its trigger while you work and pushes to the pull request once).
