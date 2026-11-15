# 0246 - A push to an open draft runs unasked

Status: accepted

## Context

0061 made shipping the user's call: the agent runs Open draft or Merge only when the user explicitly asked in the chat.
0111 let every automation run unasked inside the chat's own tree, except Open draft, Merge and those whose Thens reach them, which asked everywhere.
In the "Intel Mac" workstream (draft #203, 2026-11-13 to 2026-11-15) the first Open draft waited 9.5 hours for a yes, and the second, a push of follow-up work to that same draft, waited 20 minutes.
For that workstream a push is the test, not the shipment: its Windows and Linux jobs run only on GitHub.
Simon wants Malini to empower the agent, not gate it, so a workstream drives itself from prompt to green checks once the user asked for a draft.
A push to a draft reaches no reviewer and merges nothing; opening the pull request, marking it ready and merging do.

## Decision

- `allowedInTree` (`src/lib/chat/platform/agent/malini-approvals.service.ts`) allows `automations_run` of **Open draft**, once and without a rule, when it runs in the caller's workstream or one in its tree and that workstream has an open draft.
- An open draft is `hasOpenDraft` (`src/lib/pull-requests/pull-requests.platform.ts`), and needs both facts:
  - the ship row has phase `draft` and a pull request number, which Malini sets only once it opened or adopted the pull request;
  - the last logged `pull-requests:pull-request-changed` of the workstream names that number with state `draft`.
- A missing or unknown fact asks as before: the first draft, a pull request someone marked ready, a closed or merged one, and a workstream whose last read the event log pruned after seven days.
- Merge asks everywhere, and so does any automation whose Thens reach Open draft or Merge (`shipsWork`), open draft or not, Open draft's own Then included.
- The allow is recorded like every tree allow: scope `once`, no rule, and `not-needed` in `agent_actions`.
- `SHIP_ONLY_WHEN_ASKED` and the `automations_run` description (`packages/agent-bridge/src/claude/platform-tools.ts`) and the shipping lines of `maliniInstructions` (`instructions.ts`) tell the agent to run Open draft again after follow-up work once a draft is open, without waiting for the user; the first draft and Merge still wait for the user's explicit ask.

## Consequences

- A chat with an open draft pushes each round of fixes itself, so the checks GitHub runs on the draft join its loop without a click.
- Marking the pull request ready takes the agent's pushes back to the user, since a ready pull request reaches reviewers.
- The ready mark counts once Malini reads it: until a read logs `state: 'open'`, a push to a pull request someone marked ready on GitHub still runs unasked.
- This amends 0061's "only when the user explicitly asked" and 0111's "Open draft and Merge everywhere" for pushes to an open draft; the rest of both stands.
- Enforced by `malini-approvals.service.test.ts` ("lets Open draft push to a draft already open in the tree, and asks once GitHub says it is not one"), `tree-approvals.test.ts` (the push allowed once and recorded as automatic) and `tests/e2e/agent-actions.spec.ts` ("an agent runs the Open draft automation once the user allows it, the draft opens after its turn ends, and the next run pushes to it unasked").
