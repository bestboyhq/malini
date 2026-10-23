# 0062 - A workstream an agent starts opens on a chat that gets its prompt, and shows its setup

Status: accepted

## Context

0061 let an agent start a workstream with `workstreams_create`, which made the worktree and then synced its base and installed its dependencies in the background.
The user opened such a workstream and found only an unsaved draft, and its sidebar row sat idle while Malini was still setting it up.
They asked that starting a workstream "automatically mean that it's starting a new chat, a default one that I will see next time I go there", and said "I don't see the loading indicator on that workstream... I want more transparency".
An empty chat did not answer it: "what's the point of starting a work stream if there is no prompt from the source agent".
The sidebar's **Creating** state and the dependency install banner only followed setups the renderer ran itself, so neither saw what the main process did for an agent or a `new-workstream` job.

## Decision

- `workstreams_create` requires `prompt`, the new chat's first message.
  The approval card shows it as **First message**, and the bridge's description tells the agent that the new chat does not see its own.
- Right after the worktree exists, the tool starts a chat there with `chat.start-session`, origin `user` and the source chat's model, and returns its id as `chat`.
  A chat that fails to start fails the call with a message that the workstream exists, so the agent does not start a second one.
- Once setup ends, the tool sends `prompt` in that chat with `chat.send-prompt` and the run profile of the source run (`storedRunProfile`, parsed by `parseRunProfile`).
  The prompt is not `automated`, so Name chats names the chat from it and the workstream's shipping context reads it; a send that fails is logged.
- `prepareStartedWorkstream` in `src/lib/shared/repositories/platform/workstream-start.service.ts` emits `repositories:workstream-setup-status` with `running`, syncs the base, installs dependencies, logs a step that fails and goes on, and emits `done` in a `finally`.
  The tool runs it in the background, and the job runner's `new-workstream` jobs await it before their session starts.
- `syncWorkstreamsHook` feeds the event to `workstreamSetup` (`workstream-setup.aggregate.svelte.ts`), and `Sidebar.svelte` shows the row **Setting up** with the spinner of **Creating**.
- The same hook reports every `repositories:workstream-install-status` into `workstreamDependencyInstall`, replacing the listener `seedWorkstreamDependenciesCommand` held for its own install, so `DependencyInstallBanner` shows an install, its failure and **Retry** in any workstream.

## Consequences

- An agent hands work to another repository in one call, and the user lands on a chat named after that work, running it.
- The prompt waits for the install, like a prompt the user queues in a workstream the renderer sets up, so a chat opened during setup is empty until then.
- A message the user sends in that chat during setup takes the workstream first, and the agent's prompt then fails to send and is only logged; Activity still shows it in the call's input.
- Setup state reaches the renderer only as events: a window that reloads during a setup misses `running` and shows the row idle until that setup ends.
- A `new-workstream` job still runs in a job chat, which the tab strip hides, so its workstream opens on a fresh draft beside the **Job running** row.
- `pnpm check` fails when the event's catalog entry and `apps/site/content/reference/events.md` disagree.
- Enforced by `tests/e2e/agent-workstream-chat.spec.ts`, which holds the install open to see **Setting up**, the banner and the empty chat, then the prompt, its reply and the chat's name; by `approval-request.test.ts` and `browser-tools.test.ts` for the card and the required `prompt`; and by `tests/e2e/workstream-setup.spec.ts` for the banner of a setup the renderer runs.
