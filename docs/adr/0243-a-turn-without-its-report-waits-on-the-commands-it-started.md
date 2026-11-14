# 0243 - A turn without its report waits on the commands it started

Status: accepted

## Context

0221 ends a turn as soon as Claude Code is idle with only background commands left, so a dev server left running reads as done.
A test suite the agent starts in the background and waits for looks the same to Claude Code: both are `local_bash` tasks, and Claude Code goes on with the agent when either one exits.
So a turn that said "The end-to-end suite is running. I report when it finishes." read as done: its sidebar row went idle, it notified, and it notified again when the agent went on and ended its next turn.
The user reported a workstream that pinged many times that it was done while its agent still worked, and asked that background work the agent waits on count as the agent being busy, apart from dev servers.
The agent already says which one it is: its instructions ask for a report footer on every turn that did work, and a turn that waits ends without one, as the automation runner already reads through `hasTurnReport` (0215).

## Decision

- **The report ends the turn.**
  `ClaudeTranscript` (`packages/agent-bridge/src/claude/transcript.ts`) records with each result whether its reply ends with an `Outcome:` footer line, through `endsWithReport` in `src/claude/instructions.ts`, beside the footer it asks for.
- **A reply without it waits on the commands it started.**
  Once Claude Code is idle after such a reply while a background command runs that no earlier turn left running, the transcript waits: it emits no `turn.ended` and puts no `summary` or `providerCursor` on `background.updated`.
  The wait holds until Claude Code works again or a prompt takes the run over, so the moment a waited command exits before Claude Code goes on never reads as an end.
- **A reported turn leaves its commands running.**
  `turn.ended` adds every task left running to `#leftRunning`, and those tasks never hold a later turn, so a question asked while a dev server runs ends as done with its plain answer.
- **The reply on a wait is the end of the turn.**
  `turnEndedOverBackgroundCommands` in `src/lib/chat/platform/events.repository.ts` asks for a `summary`, so `FinishedTurns` announces `chat:turn-finished` on the same update the lifecycle monitor, `replyOverCommands` and the automation runner already read.
- The instructions add that a turn that ends to wait for a background command gets no report, and that a server left running for the user does not wait, so that turn reports.
- The session machine, the bridge protocol and every reader of `isAgentWorking` stay as 0221 left them: a waiting turn keeps its session `running`, so its row, tab, top bar and status line read as working and say **Waiting on 1 background command**.

## Consequences

- A chat notifies once per finished turn: when the agent reports, not when it starts to wait.
- A prompt sent while the agent waits still takes the run over (0221), and the commands it handed over still hold the next turn until a turn reports.
- An agent that leaves a server running and forgets its report keeps its chat working until the server stops or a later turn reports; the stop button and the tray still stop it.
- The footer check lives twice, in `endsWithReport` in the bridge and `hasTurnReport` in the app's chat domain, since the bridge cannot import the app; a change to the footer changes both.
- Enforced by `packages/agent-bridge/src/claude/transcript.test.ts` ('keeps the turn going while its reply has no report…', 'ends the turn whose report leaves its command running…', 'ends a plain answer over a command an earlier turn reported…', 'keeps waiting when the awaited command ends before Claude Code goes on…'), the background command tests in `session.test.ts`, and `runs-events.repository.test.ts` for the `summary` the app reads.
