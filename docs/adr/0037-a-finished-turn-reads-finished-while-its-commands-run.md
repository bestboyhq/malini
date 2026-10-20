# 0037 - A finished turn reads finished while its commands run

Status: accepted

## Context

ADR 0009 keeps a run open while its background work runs, and as a consequence a chat waiting on that work kept its sidebar spinner until the work settled.
A dev server never settles, so a workstream whose agent was done kept spinning for hours, hid how its turn ended (Ready, Needs you), and raised no chime.
The user kept opening workstreams that looked busy only to find a dev server, and asked for the sidebar to say what is running instead of looking busy.
Matching commands by words like `dev` or `serve`, or by an open port, guesses wrong both ways (`node dev.ts --lab` serves, `pnpm check` does not, e2e suites open ports of their own); whether the agent's turn has ended is the one signal that holds.
The run itself still has to stay open (ADR 0009), so the change is in what the run reports and how malini reads it.

## Decision

- The bridge adds the turn's result text as `summary` to the first `background.updated` with `waiting: true` after a successful result (`packages/agent-bridge/src/claude/session.ts`, `transcript.ts`).
- A run that only waits on background commands reads as finished: the workstream row, the chat tab and attention treat that `background.updated` like a `run.completed`, so it chimes, notifies and shows Ready or Needs you (`workstream-chat-summary.ts`, `agent-chat-identity.ts`, `agent-lifecycle-monitor.service.ts`).
  A background agent, or any task that is not a command, is the agent still working and keeps the spinner.
  The top bar says **Commands running** instead of **Agent running**, because shipping still waits for the open run.
- The main process keeps one snapshot of what runs in each workstream (`lib/stats/platform/workstream-running.ts`): the open runs' background commands, read from `agent_events`, and the Docker Compose services whose working directory is inside the workstream.
  Ports come from `lsof` on the processes that hold a command's output file and their descendants, and from Docker's published ports.
  A Compose service another running service depends on is folded into "Behind them" instead of being listed.
  The renderer reads it through `stats.workstream-running` and `stats:workstream-running-changed`, and stops items through `stats.stop-running`.
- The built-in automatic job **Name services** (ADR 0011) names each background command once, from the agent's description, the command and its package: a short outcome name for what stays up, `task:` and plain words for what ends on its own.
  Until it answers, or when it fails, the package the command runs in stands in, or its folder when only the repository root has a `package.json`.
- The sidebar row shows those names on a second line, and hovering the row opens a card on the shared tooltip, now able to hold live, clickable content, with each item's ports, running time and a stop button.
  The workstream's context menu (Shift+F10) offers the same stops, since the card is reachable by pointer only.

## Consequences

- The spinner means one thing: the agent is working.
- Closing a chat whose turn ended still stops its commands, so the close confirmation still warns.
- Shipping still waits until the commands stop, since the run they belong to stays open (ADR 0009).
- A second chime can follow when a finite command ends and the agent picks up again with a new report; the same report never chimes twice.
- Background work started outside an agent's run, like a server the user started in a terminal, is not listed.
- Enforced by the bridge tests in `session.test.ts` and `transcript.test.ts`, the summary, identity and lifecycle monitor tests in `lib/chat`, the parsing tests in `lib/stats/platform`, `sidebar-running.browser.test.ts`, and `tests/e2e/background-agents.spec.ts`.
