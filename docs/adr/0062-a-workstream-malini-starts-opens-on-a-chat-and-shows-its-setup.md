# 0062 - A workstream Malini starts opens on a chat and shows its setup

Status: accepted

## Context

0061 let an agent start a workstream with `workstreams_create`, which made the worktree and then synced its base and installed its dependencies in the background.
The user opened such a workstream and found only an unsaved draft, and its sidebar row sat idle while Malini was still setting it up.
They asked that starting a workstream "automatically mean that it's starting a new chat, a default one that I will see next time I go there", and said "I don't see the loading indicator on that workstream... I want more transparency".
The sidebar's **Creating** state and the dependency install banner only followed setups the renderer ran itself, so neither saw what the main process did for an agent or a `new-workstream` job.

## Decision

- `workstreams_create` starts a chat in the new workstream with `chat.start-session`, origin `user` and no name, right after the worktree exists, and returns its id as `chat`.
  A chat that fails to start is logged and returns `chat: null` without failing the call, since the workstream already exists and a retry would start a second one.
- `prepareStartedWorkstream` in `src/lib/shared/repositories/platform/workstream-start.service.ts` emits `repositories:workstream-setup-status` with `running`, syncs the base, installs dependencies, logs a step that fails and goes on, and emits `done` in a `finally`.
  The tool runs it in the background, and the job runner's `new-workstream` jobs await it before their session starts.
- `syncWorkstreamsHook` feeds the event to `workstreamSetup` (`workstream-setup.aggregate.svelte.ts`), and `Sidebar.svelte` shows the row **Setting up** with the spinner of **Creating**.
- The same hook reports every `repositories:workstream-install-status` into `workstreamDependencyInstall`, replacing the listener `seedWorkstreamDependenciesCommand` held for its own install, so `DependencyInstallBanner` shows an install, its failure and **Retry** in any workstream.
- The bridge's `workstreams_create` description names the chat and drops the `ready` and `cloning` statuses the tool never returned.

## Consequences

- The user lands on the agent's new workstream in a chat of its own, which Name chats names from its first message.
- Setup state reaches the renderer only as events: a window that reloads during a setup misses `running` and shows the row idle until that setup ends.
- A `new-workstream` job still runs in a job chat, which the tab strip hides, so its workstream opens on a fresh draft beside the **Job running** row.
- `pnpm check` fails when the event's catalog entry and `apps/site/content/reference/events.md` disagree.
- Enforced by `tests/e2e/agent-workstream-chat.spec.ts`, which holds the install open to see **Setting up**, the banner and the chat, and by `tests/e2e/workstream-setup.spec.ts` for the banner of a setup the renderer runs.
