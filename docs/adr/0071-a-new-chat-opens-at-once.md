# 0071 - A new chat opens at once and sets up its lead checkout behind it

Status: accepted

## Context

0070 started a lead with `repositories.create-lead { scope }`, and the sidebar's **New chat** rows waited for it before they opened the chat, with nothing to show meanwhile.
On the user's own data a new chat took 420 to 550 ms from the click to a usable composer, while **New workstream** took 57 ms, and the user clicked again while nothing seemed to happen: three logdash-io chats in 7 seconds, two of them archived right after.
`git worktree add` in the lead space took 330 to 465 ms of that, most of it the user's global hooks (`core.hooksPath`): about 20 `reference-transaction` and `post-checkout` runs of 13 to 15 ms each, in a repository with no hooks of its own.
A new workstream already plans its id and name in the renderer, stages a pending row, opens at once and builds its checkout behind it, and its queued prompts and its setup failure banner come with that path.

## Decision

- **New chat** plans the lead in the renderer (`planLeadChatProvisioning` in `src/lib/shared/repositories/domain/provisioning.ts`) and starts it with `startPlannedWorkstreamCommand`, the path **New workstream** takes: a pending row, the chat at once, the checkout behind it.
- `WorkstreamProvisioningPlan` is a `RepositoryWorkstreamPlan` or a `LeadChatPlan`, told apart by `scope`, so a lead plan carries no clone source.
- `repositories.create-lead { scope, workstreamId, name }` creates the planned lead.
  `provisionWorkstreamCommand` calls it for a lead plan and skips the base sync and the dependency install, which a lead has no use for.
- A prompt sent before the checkout exists waits in the queue (`workstreamReadyForPromptsQuery`) and goes out once setup is ready.
  A checkout that fails shows the setup banner with **Retry setup** and **Remove**, as a workstream's does, instead of a toast and no chat.
- **+** and **File → New Chat** start no session while the checkout is still missing (`worktreePendingQuery` in `startFreshChatCommand`), since the chat on screen is already fresh; before, they failed with "This workstream's folder is missing." in every workstream still setting up.
- `prepareLeadSpace` sets `core.hooksPath=/dev/null` in the lead space's own config on every start, so no git hook runs there: it is Malini's own repository, with no remote and no hooks of its own.

## Consequences

- On the user's data a new chat shows its composer 41 to 63 ms after the click and its checkout is ready at 117 to 173 ms; `git worktree add` in the lead space takes 24 to 43 ms.
- A lead row shows **Creating** for that tenth of a second, like a new workstream row while it sets up.
- Git hooks never run in the lead space, neither for Malini nor for a lead's agent.
- `tests/e2e/lead-chats.spec.ts` enforces it: "a new chat opens before its checkout exists, and a prompt sent meanwhile goes out once it is ready" holds the lead space's `git worktree add` with a `git` shim on `PATH` and presses **+** meanwhile, and "a new chat whose checkout fails says why, retries in place with its prompt, and removes a failed one" fails it.
  `workstreams.test.ts` checks the planned id and name and the hooks setting on real git.
