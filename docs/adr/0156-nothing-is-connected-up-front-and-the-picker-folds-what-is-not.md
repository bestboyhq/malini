# 0156 - Nothing is connected up front, and the picker folds what is not

Status: accepted

## Context

Onboarding step 1 would not continue until Claude Code was signed in, so someone without a Claude plan could not get past it, while a DeepSeek or OpenCode key runs Claude Code just as well (0148).
The user ruled out asking for a key there: "we don't want to ask them for API key up front", they "pick the model that they want" in the picker, "then we may pull up providers and let them connect".
0149 already asks for a provider at send, but its one flat list put OpenCode's 72 models, each marked **No access**, between the user and the models they can run.
This ADR replaces only 0149's flat list; its access rule, connect card and edit gate stay in force.

## Decision

- Onboarding's Claude Code row shows **Skip** next to **Sign in** when Claude Code is installed and signed out; the hint reads "Sign in opens your browser. No Claude plan? Skip it".
  `claudeCodeOnboardingStatus` in `src/lib/app/domain/onboarding.ts` turns a skipped signed-out probe into `skipped`, which settles the step like `ready` and folds the row to "Skipped. Other models it is", which reopens on click.
  A missing Claude Code cannot be skipped, since every run goes through it.
  The skip lives in the component's state, so a relaunched onboarding asks again; past onboarding, the Repositories card still offers the sign-in, without **Skip**.
- Onboarding asks for no provider key.
- `pickerEntries` in `src/lib/shared/providers/domain/model-catalog.ts` builds the picker's rows: Claude and every provider with a key list their models, and every other provider is one `chat-model-provider` row reading "<n> models, one key away" with `aria-expanded`.
  Opening that row lists its models below it, each still selectable with **No access**, and scrolls the row to the top of the list.
  The picker opens with the selected model's provider expanded and that model scrolled into view.
  A filter query searches every provider's models, folded or not.
- Sending on a folded provider's model opens 0149's connect card unchanged.

## Consequences

- Someone with only a DeepSeek or OpenCode account finishes onboarding, picks a model in the first chat, and connects at send; from then on 0152's last pick starts every new chat there.
- Someone who skips Claude by mistake can reopen the row before Continue, or sign in later from Repositories or **Settings → Providers**.
- A provider added later costs the picker one row until it is connected, so the list stays short however large models.dev's catalog is.
- Enforced by `onboarding.test.ts` (a signed-out Claude Code can be skipped, a missing one cannot), `model-catalog.test.ts` (unconnected providers fold until opened or searched), `tests/e2e/first-run.spec.ts` (skip folds the row and enables Continue, the Repositories card has no **Skip**), and `tests/e2e/provider-models.spec.ts` (folded rows, opening one, filtering past the fold, the selected provider expanded on reopen).
