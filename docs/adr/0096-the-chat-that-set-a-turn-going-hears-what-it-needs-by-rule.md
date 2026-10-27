# 0096 - The chat that set a turn going hears what it needs, by rule

Status: accepted

## Context

0085 lets Haiku pick among Do nothing, Wake that chat and Ask you when a turn ends in a workstream a chat started, 0090 made that chat the lead that speaks for its workstreams, and 0091 kept the model step always on.
The user's lead "Public profile workstreams" started "Public profile build" and ended its own turn with "Send 'Public profile build' the full contract when its turn ends."
That turn ended with "Needs: Pick a comparison variant: A, B, C or D (I recommend C)", and the model picked Ask you, although its facts said the lead started the work and was idle.
The decision waited in Activity as `asking`, the lead was never woken and never sent its contract, and the lead's chat showed nothing about it while its top bar said "1 needs you".
The user: "it looks like some children work stream finished and it failed to notify the parent chat properly".
The model sees a one-line `Needs:` and the lead's last report, while the lead holds the plan and can tell what it answers from what only the user decides; 0090 quoted the user, "always the parent chat should just aggregate the information for me", and 0085 settled on "rules first, the agent second".

## Decision

- `TurnFinishedSituation.starterInChain` (`src/lib/jobs/domain/reconciler.ts`) says whether the chat that started the workstream ran in the chain the turn belongs to, which `sessionRanInChain` (`src/lib/chat/platform/runs.repository.ts`) reads from `agent_runs.chain_id`.
  It holds for a turn that chat's `workstreams_create` or `workstreams_send` set going, for a wake it answered, and for a resumed turn of either; a prompt you send in the workstream's own chat starts a chain of its own.
- `rulesReason` gives the reason Malini's rules decide when such a turn needs something or failed, and `Reconciler.#reconcile` then never asks the model: `validatePick` takes its default, the wake, recorded with `pick: null`, `decidedBy: 'rules'` and the reason as `detail`, such as "“Public profile workstreams” set this turn going, so it hears what the turn needs before you do."
- The wake budget still holds: the fourth wake about the same work in one chain becomes an ask (`RECONCILER_WAKE_LIMIT`).
- The model still picks for a turn that needs nothing, a turn the lead did not set going, a job run and a conflict, and its facts now say which: "The lead chat “X” started it and set this turn going." or "… started it, but not this turn."
- The agent instructions (`packages/agent-bridge/src/claude/instructions.ts`) say Malini wakes the chat for a turn it set going that fails or needs something, where they said it can.

## Consequences

- A lead always hears the needs and failures of the turns it set going, answers what its plan covers, and passes up in its own `Needs:` only what the user decides, so its report is the one place to read; each of those turns costs no Haiku call.
- A turn you set going yourself in a started workstream stays with the model, which now knows the lead did not set it going, so the lead does not answer over you.
- Ask you, for a turn, now comes only from the wake budget or from the model on a turn the lead did not set going; such an ask still shows only in Activity, on the Jobs badge and in a notification that opens the lead, whose transcript does not show it.
- A wake the rules decide skips `runAutomaticJob`, so Improve has no recorded input for it.
- This changes 0085's line that the model picks for every turn that ends in a workstream a chat started, and 0091's line that the model step picks for every event no trigger matched; the rest of both stands.
- Enforced by `src/lib/jobs/domain/reconciler.test.ts` (`rulesReason`, the facts about who set the turn going), `src/lib/jobs/platform/reconciler.service.test.ts` ("wakes the chat that set a turn going with what the turn needs or its failure, without the model, until the wakes run out", and the asks on a turn the lead did not set going), and `tests/e2e/event-reconciler.spec.ts`, which fails when a lead is not woken with what a workstream it set going needs while the model would ask you, or when the model's ask about a turn you set going cannot be answered in Activity.
