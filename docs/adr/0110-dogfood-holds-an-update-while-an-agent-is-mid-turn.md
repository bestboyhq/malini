# 0110 - Dogfood holds an update while an agent is mid-turn

Status: accepted

## Context

`pnpm dogfood` runs the user's daily Malini from a checkout of `main` and applies every merge it pulls, restarting the app when the change needs it.
While the "Public profile workstreams" chat worked, dogfood restarted Malini on ten merges: that killed 13 runs and posted 12 "Malini restarted…" prompts that look like the user's own.
Resume (0085, 0100) continues a cut turn, but a restart still loses the turn's live state, and every restart costs the agents their running Claude Code.
The user wants things to "just work" while agents run on their own.

## Decision

- `agentsMidTurn` (`apps/malini/scripts/dogfood.mjs`) opens the app's database read-only with `node:sqlite` and counts the open runs of chats that are not archived, leaving out runs that only wait on background commands (0037).
- `follow()`, which polls `origin/main` every 15 seconds, holds a pulled update while the app runs and an agent is mid-turn, says "holding the update until no agent is mid-turn (N working)" once per update, and applies it on the first poll with none.
- A database it cannot open counts as no agent at work.

## Consequences

- A merge lands between turns, so an agent at work never loses its turn to an update of the app it runs in.
- An update waits as long as some agent keeps working, and one that never ends its turn holds it until you stop that run.
- A dev server or a watcher left running in the background does not hold updates.
- `AGENTS.md` describes `pnpm dogfood` as applying every merge once no agent is mid-turn.
- Enforced by `apps/malini/scripts/dogfood.test.mjs` ("an update waits for agents mid-turn, not for runs that only wait on commands"), which `pnpm lint` runs through `test:scripts`.
