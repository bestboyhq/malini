# 0196 - The usage panel leads with the chat's provider

Status: accepted

## Context

0195 read an OpenCode Go key's usage only while an OpenCode model was picked, and the panel behind the composer's gauge listed every connected provider in full under **Providers**: each Claude account with its windows, ChatGPT and every key.
With three or four providers connected, the usage of the model in the chat sat among rows that did not apply to it, and each limit took three lines over a 6px bar.
The user asked for "only usage relevant to the provider for a currently selected model, and then some kind of gutter for other providers, not all at once", and said "those progress bars should be less tall".
Out of four prototypes they picked the list, "because it will also work if I have, for example, two different claude accounts".
A list that shows OpenCode while a Claude model is picked needs OpenCode's reading then too, which 0195's read trigger did not allow.
This replaces 0195's panel layout and its read trigger; its endpoint, parsing, plan gate, sixty-second cache and chip rule stay in force.

## Decision

- `SessionRuntimeControls` takes its lead from the composer's picked provider (`selection.provider`, Claude when none): one section named after that provider, with **Manage providers**, shown only once the provider is ready.
  - Claude: `ClaudeAccountList` with the signed-in account's windows under it, and each other account's highest current window next to its **Switch**, from `planUsageQuery.of(email)` through the list's `other` snippet.
  - ChatGPT: the account, **Manage usage** and the plan or limit line, as before.
  - A keyed provider: "Go plan" or "API key" next to its name, and OpenCode's windows when a reading is in.
- Every other ready provider is one line in a gutter at the bottom of the panel, `<ul aria-label="Other providers">` on `bg-surface-50`: its icon, its name, and its highest current window as "5-hour · 96%" (`highestPlanLimit` in `chat/domain/plan-usage.ts`), or "Claude Max", "ChatGPT plan", "Usage limit hit", "Go plan" or "API key" when it has none.
- Each Claude account is its own line in that gutter, named by its email once more than one is known, so a second account's weekly limit stays in sight.
- A limit row is one line, its label, "Resets in …" and "N% used", over a 4px bar (`h-1`); the context bar is 4px too.
- The OpenCode reading loads while an OpenCode model is picked, as in 0195, and each time the panel opens with an OpenCode key saved; the main process keeps its sixty-second cache and its Go plan gate, so a Console key still costs no call.
- The composer chip follows only the lead: `planLimitAlert` of Claude's windows for a Claude model, of OpenCode's for an OpenCode model, and none for the rest.

## Consequences

- The panel answers for the model in the chat first, and every other plan is a glance below it, red from 90%.
- Two Claude accounts both stay visible: the checked one in full and the other with its highest window beside **Switch**, or one line each in the gutter under another provider.
- opencode.ai sees one more read when the panel opens under a model from another provider, still at most once a minute.
- A provider that is not connected never shows in the panel; for a picked one, the connect strip under the prompt (0186) speaks.
- Enforced by `plan-usage.test.ts` (`highestPlanLimit`), `tests/e2e/context-and-plan-usage.spec.ts` (Claude's 93% moves to the gutter once DeepSeek is picked), `tests/e2e/provider-models.spec.ts` (DeepSeek leads with "API key" over a Claude line, and OpenCode's "5-hour · 96%" sits in the gutter once Opus is picked), `tests/e2e/claude-account-switch.spec.ts` (the other account's "5-hour · 93%" beside **Switch**) and `tests/e2e/chatgpt-provider.spec.ts` (ChatGPT leads).
