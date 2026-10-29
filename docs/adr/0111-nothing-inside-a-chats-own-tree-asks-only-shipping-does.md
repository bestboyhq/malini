# 0111 - Nothing inside a chat's own tree asks; only shipping does

Status: accepted

## Context

0053 and 0061 made every Malini write ask the first time, under one remembered action each: cloning, hiding, starting, archiving, sending, saving a job or running one.
In the "Public profile workstreams" chat, ten approvals were plumbing: nine prompts the lead relayed to its own workstreams and one archive of a workstream it had started, and five of them were lost to restarts.
The user: "my expectation as a user is that I will feel like there is a single chat. and I don't need to go to sub chat or approve anything and kinda stuff just works".
What a chat starts, sends and archives inside the work it started changes nothing outside it, while shipping reaches GitHub and stays the user's call (0061, 0067).

## Decision

- Bridge protocol 43 pre-approves `workstreams_create` and `workstreams_send`, beside the new `decisions_ask`, `decisions_answer` and `plan_write` (0112, 0113), in `PRE_APPROVED_PLATFORM_TOOLS` (`packages/agent-bridge/src/claude/platform-tools.ts`), so Claude Code never asks for them.
- `tryAutoApprove` (`src/lib/chat/platform/agent/runtime.ts`) allows, once and without a rule, a Malini call that `allowedInTree` (`malini-approvals.service.ts`) finds inside the caller's tree, its own workstream and every workstream started under it (`descendantWorkstreamIds`):
  - `workstreams_archive` of a workstream in that tree;
  - `jobs_run` of exactly one job, in the caller's workstream or one in its tree, unless the job is Open draft or Merge or its Thens reach one of them (`shipsWork`).
- The automatic allow is a resolved interaction with scope `once` and no rule (`finalizeInteractionResponse`, `interactions.repository.ts`), and `agent_actions` records its call as `not-needed`, so Activity shows no approval on it.
- Everything else still asks: cloning or hiding a repository, archiving a workstream outside the tree, saving a job, running a job elsewhere, and Open draft and Merge everywhere.
- The e2e fake bridge mirrors the pre-approved tools (`PRE_APPROVED_TOOLS` in `tests/e2e/fixtures/fake-bridge.cjs`), so `MALINI_TOOL` asks only for a tool the real bridge asks for.

## Consequences

- A lead starts, briefs, archives and re-runs its own work without a click; the user is asked only to decide (0112) and to ship.
- **Always allow** no longer offers starting or sending, since neither asks; rules saved for them stay and match nothing new.
- A job run inside the tree is trusted like the chat that runs it: every job but Open draft and Merge, and those whose Thens reach them, runs there unasked, whatever its instructions do.
- The fake bridge's list must follow `PRE_APPROVED_PLATFORM_TOOLS`, or e2e specs assert approvals the product never shows.
- This changes 0053's and 0061's "every write asks the first time" for these calls; the rest of both, reviews included, stands.
- Enforced by `tree-approvals.test.ts` (an archive and a job inside the tree allowed once and recorded as automatic, a workstream outside it asked, a saved rule kept), `malini-approvals.service.test.ts` ("never lets Open draft or Merge run unasked, nor a job whose Thens reach them"), the bridge's `session.test.ts` (the pre-approved tools), and `tests/e2e/agent-actions.spec.ts` ("an agent clones a repository, starts and archives a workstream in it without asking, hides it, and Activity shows every call with its outcome"), `agent-workstream-chat.spec.ts`, `child-requests.spec.ts` and `lead-timeline.spec.ts`.
