# 0153 - Dogfood applies every merge at once, and Resume carries the cut turns

Status: accepted

## Context

0115 held a pulled update while any agent was mid-turn, so a merge landed only between turns.
The user always has agents at work, so a held update waited on them indefinitely: "I always have some agents running and everyone has some agents running always."
They preferred the restarts and asked for "a mechanism that will keep it recoverable but not blocked".
Recovery already exists: a quit pauses each running turn (`PAUSED_FOR_EXIT_ERROR`), Resume continues it once Malini started (0085), and deliveries between chats survive a restart (0109).
What stayed broken was how a resumed turn reads: the transcript drew Malini's continuation prompt as a prompt bubble, as if the user had typed it.
The user's database holds 212 of them, 87 more in an older lowercase "malini restarted…" wording, and 6 sent after a limit or an outage (0100); the lead brief and lead timeline skipped only the current wordings.
The user turned down a serious notice, and weary ones too, because "they all sound kinda serious and like Claude is forced to do it", then picked two upbeat lines per cause and asked to "roll them".

## Decision

- `follow()` in `apps/malini/scripts/dogfood.mjs` applies a pulled update on the poll that sees it, whether or not an agent is mid-turn.
  `agentsMidTurn` and its read-only open of the app's database are gone.
- `continuationCause` in `$contract/agent-state-machine` recognizes a continuation Malini sent, `restart` or `outage`, in every wording it has sent, by comparing case-insensitively.
- `ChatTimelineRow` draws a continuation as a divider instead of a prompt bubble, with a line `continuationNotice` (`chat-message-list/run-stop-copy.ts`) rolls from its cause's pool by the event's `seq`, so a divider keeps its line across renders.
  After a restart it reads "Malini restarted. Probably better now" or "Malini restarted. Fresh start, same task", and after a limit or an outage "Claude is back. Well rested" or "Claude is back. Coffee break over".
  `TranscriptDivider` draws it and the context handoff divider, which it replaces.
  It stays a `user` item, so the run's opening, its undo and the scroll to a new prompt work as before.
- `leadBrief` and the lead timeline skip continuations through the same `continuationCause`, so the older wording no longer reads as the user's.

## Consequences

- A merge reaches the daily app within a 15 second poll, however many agents are at work.
- Every restart cuts the turns at work: each loses its live state, its running Claude Code and its running commands, and Resume asks it to re-run the step it was on.
  An update that needs a fresh dev server waits up to 60 seconds for the app to quit before it kills it.
- A new continuation prompt needs its wording in `continuationCause`, or the transcript draws it as the user's again.
- `AGENTS.md` describes `pnpm dogfood` as applying every merge as it lands.
- Enforced by `run-stop-copy.test.ts` ("rolls a notice for each continuation Malini sent, in every wording it has sent") and `tests/e2e/event-reconciler.spec.ts` (a turn a restart cut short goes on under a "Malini restarted." divider, with no prompt bubble).
  Nothing enforces that dogfood never holds an update.
