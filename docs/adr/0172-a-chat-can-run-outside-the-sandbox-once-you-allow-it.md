# 0172 - A chat can run outside the sandbox once you allow it

Status: accepted

## Context

From #153 to Nov 7, chats asked 32 times to run a command outside the sandbox 0167 added, and the user asked "why am i being asked so often for the sandbox?", then "nearly all the time".
15 asks came from a Malini an agent launched to test itself: 0167 hid every folder named `malini-secrets-<pid>-` wherever it sat, so that Malini's bridge failed with `START_SESSION_FAILED: EPERM mkdtemp …/malini-secrets-78985-XXXXXX` and the agent ran it outside.
10 came from WebGL captures, which run inside the sandbox on the real GPU; the agent's script had turned the GPU off and blamed the sandbox.
One came from stopping a dev server an earlier command started, since each command runs in a sandbox of its own and Seatbelt lets a command signal only its own.
Every card offered only **Allow once**, so a chat that kept working outside asked every time, as the `ponytail:` on `confineCommands` warned.
The rest of 0167 stands.

## Decision

- `sandboxProfile` in `packages/agent-bridge/src/sandbox.ts` takes the temporary folder, `tmpdir()` by default, and hides only the `malini-secrets-<pid>-` folders directly in it, which is where every bridge puts its own.
  The `test-malini-app` launcher sets `TMPDIR` to `<profile>/tmp`, so the bridge of a Malini it starts keeps its secrets folder there, inside a folder the sandbox can write.
  The e2e harness runs the fake bridge, which keeps no secrets folder.
- Signals still reach only the same sandbox, since letting a command signal any process would let it open a Node inspector in one that runs outside.
  Malini's instructions tell the agent that a command cannot stop a process an earlier command started, to start a server with `run_in_background` and to stop it with TaskStop, and to run the next command inside the sandbox again after one that left.
- A sandbox exit card shows **Allow for this chat** between **Deny** and **Allow once**.
  The bridge keeps that allow on the `ClaudeSession` in memory, and `confineCommands` lets every later exit in that chat through with a one-time pass of its own, as Full access does.
  Plan mode still asks, nothing goes into Claude Code's settings or Malini's rule store, and a new chat, or the same chat after Malini restarts, asks again.

## Consequences

- A Malini that an agent launches runs real chats inside the sandbox, and so do the bridge's secrets tests, so neither asks.
- A chat the user lets out keeps working without a card per command; that chat can read and change anything a command outside can, until Malini restarts.
- Another bridge's secrets stay hidden, since every bridge keeps them directly in the system temporary folder; a folder with that name elsewhere is readable, which only a Malini started inside the sandbox makes, and that Malini's commands could reach the keychain already.
- Enforced by `sandbox.test.ts` (another bridge's secrets folder stays hidden, a Malini a command starts keeps its own), `permissions.test.ts` (plan mode still asks after an allow for this chat), `session.test.ts` (every later exit in the chat runs outside on a pass of its own, while an allow once and another chat ask again) and `agent-interactions.spec.ts` (the card's **Allow for this chat**), the first three on macOS only.
