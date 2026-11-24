# 0302 - Widget actions ask the chat you are in, and ⌘ asks a new one

Status: accepted

## Context

0298 gave **New widget** its own workstream and made **Make default** open its pull request from a new background workstream, and 0301 made **Add <server>** start a workstream too.
Simon found that **Make default** "shouldn't just assume to send it to a new work stream", and asked for "a current work stream maybe to a new chat until I press command".
He asked for the same experience Malini already has on a report's next steps, where ⌘ turns **Ship** into **Slice, fork, ship**, "for those operations related to widgets".
Asked where a click and a ⌘-click go, he picked the chat you are in for a click and a new chat in the same workstream for ⌘, the same as **Ship**.
A default widget in the current workstream also lands in that workstream's pull request, with the rest of its work.
This amends 0298 and 0301: no widget action starts a workstream.

## Decision

- `shipPromptCommand` in `src/lib/chat/application/commands/ship-prompt.command.ts` sends a prompt to the chat shown in the workstream, or starts that chat when it has no session yet.
  With `inNewChat` it calls `shipInNewChatCommand`, which starts a new chat in the workstream without showing it, the same path **Slice, fork, ship** takes with a transcript and a widget takes with none.
- **New widget**: Return sends "Make me a widget that shows …" to the chat you are in, and ⌘Return sends it to a new chat.
- **Make default for this repository**: `widgets.share` copies the widget file into `.malini/widgets/` of the same workstream's checkout, then the prompt asks the agent there to check it and open a draft pull request.
  `widgets.share` takes only `workstreamId` and `widgetId`; the `into` workstream and the wait for `repositories:workstream-created` are gone.
  Holding ⌘ turns the menu item into **Make default in a new chat**.
- **Add <server>** on a tile sends its `mcp_servers_add` prompt the same way, and holding ⌘ turns it into **Add <server> in a new chat**.
  **Sign in** and **Turn on** ask no agent, so ⌘ leaves them as they are.
- `commandKeyHeld()` in `src/lib/shared/shell/command-key.svelte.ts` tracks ⌘ for every control that swaps its label, the next steps' **Ship** included.
  It listens to the window only while a control reads it, and a click decides from its own `metaKey`.

## Consequences

- A widget action never leaves the workstream you are in, and a default widget ships in that workstream's pull request.
- A busy chat queues the prompt behind its turn, as **Ship** does; ⌘ is the way to run it beside that turn.
- A new control that asks an agent from outside the composer uses `shipPromptCommand` and `commandKeyHeld()`, so a click and ⌘ mean the same everywhere.
- Enforced by `tests/e2e/widget-card.spec.ts` (Add in this chat and in a new chat, Make default copying into the worktree and asking this chat, New widget with Return and ⌘Return) and the make-default case of `src/lib/widgets/platform/register.test.ts`; nothing checks that a future control uses `commandKeyHeld()`.
