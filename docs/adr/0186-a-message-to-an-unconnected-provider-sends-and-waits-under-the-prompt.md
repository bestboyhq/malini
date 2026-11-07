# 0186 - A message to an unconnected provider sends, and waits under the prompt

Status: accepted

## Context

0149 had Send on a model without access open `ProviderConnectCard` above the composer, echoing the prompt while the composer still held the same draft.
Once 0185 let any chat open on any model, that card became the first thing a signed-out send met, and the user said: "after sending a msg im confused i have both composer and permission prompt".
Moving the card into the composer's place still left the prompt unsent, so they asked: "couldnt we just send a message, or make it look like it sent prompt, and underneath show the gutter with CTA? just like with suggested automation", and picked the prototype that sends for real.
0185's `readyEnvironment` also answered `null` on any error, so a DeepSeek key the keychain could not read opened its chat in silence instead of saying so, which `agent-bridge-failures.spec.ts` caught.
This replaces 0149's connect card and edit gate, which 0158 and 0160 kept, and 0185's catch-all; 0149's `modelAccess` rule and the rest of 0185 stay in force.

## Decision

- Send always sends.
  `submitPromptCommand` reads `modelAccessQuery` from `$shared/providers`, and when `isModelAccessReady` says no, it mints the chat's session if it has none, then puts the prompt in the chat's prompt queue instead of dispatching it, so the composer clears.
- A queue entry with a session that is not forced fresh, on a model that is not ready, is held.
  `promptDelivery.nextDeliverable` and `#deliver` skip it, and `releaseWaitingPromptQueuesHook` drains again whenever the provider list or the Claude status changes.
- `heldPromptQuery` finds a chat's held entry.
  `ChatMessageList` draws it as the chat's next prompt with `ProviderConnectStrip` under it, built like the suggested-automation strip, and `TranscriptRun` gives it no status line; `LeadTimeline` draws it as a **You** row with the same strip; the queue tray leaves it out.
- The strip asks what `modelAccess` names: a ChatGPT or Claude Code sign-in, a DeepSeek or OpenCode key with **Get a key**, **Set up** when Claude Code is missing, and only **Cancel** when the ChatGPT plan lacks the model.
  Connecting drains the queue; **Cancel**, or Escape while focus is in the strip or nowhere, runs `withdrawHeldPromptCommand`, which puts the prompt back in the composer as its draft.
- The sidebar reads **Needs you** for a workstream with a held prompt, not **1 queued**, through `held` in `summarizeWorkstreamChat`.
- An edited prompt rewinds its checkpoint and then sends through `submitPromptCommand`, so it holds the same way; `ProviderConnectCard` and the edit gate in `ChatPromptBubble` are deleted.
- `readyEnvironment` in `src/lib/chat/platform/agent/commands.ts` answers `null` only for `ProviderNotConnectedError`, from `$shared/providers/domain/provider-env.ts`, which `ProviderKeys.environment` throws for a missing key and for a model the provider does not offer a new session; any other error, such as an unreadable key, fails the open as before 0185.

## Consequences

- The prompt shows once, as sent, and the queue keeps it per workstream in `localStorage`, so it survives switching chats and restarting Malini.
- A held prompt keeps the model it was sent with; picking another model in the composer does not move it, so running it elsewhere means **Cancel** and send again.
- Before the provider list loads at launch, a DeepSeek, OpenCode or ChatGPT entry reads as not connected, holds for that moment, and the hook releases it.
- A Claude probe that is still checking counts as ready, as 0149 decided, so it never holds.
- A ChatGPT session can register with the bridge on a model the plan turns out to lack, in the moment after sign-in before the plan's list refreshes; no prompt reaches it.
- Enforced by `tests/e2e/unconnected-provider-chat.spec.ts` (send, strip, Escape back to the draft, a chat switch and a restart, then ChatGPT and DeepSeek connect and run), `lead-timeline.spec.ts` (a Home chat), `chatgpt-provider.spec.ts` (a plan without the model holds with no prompt at the bridge, and **Cancel** lets you resend on another), `provider-models.spec.ts`, `first-run.spec.ts`, `agent-bridge-failures.spec.ts` (an unreadable key still says so) and `workstream-chat-summary.test.ts` (**Needs you**).
