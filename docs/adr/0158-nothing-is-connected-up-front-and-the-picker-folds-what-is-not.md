# 0158 - Nothing is connected up front, and the picker folds what is not

Status: accepted

## Context

Onboarding step 1 would not continue until Claude Code was signed in, so someone without a Claude plan could not get past it, while a DeepSeek or OpenCode key runs Claude Code just as well (0148).
The user asked "why do you even show a button for signing into" Claude in onboarding, and ruled out asking for a key there: "we don't want to ask them for API key up front", they "pick the model that they want" in the picker, "then we may pull up providers and let them connect".
0149 already asks for a provider at send, but its one flat list put OpenCode's 72 models, each marked **No access**, between the user and the models they can run.
This ADR replaces only 0149's flat list; its access rule, connect card and edit gate stay in force.

## Decision

- Onboarding asks for no sign-in and no key: `claudeCodeOnboardingStatus` in `src/lib/app/domain/onboarding.ts` takes a signed-out Claude Code as `ready`, so the Claude Code row checks off once it is installed and reads "Installed on this Mac · v<version>", or "Signed in as <email>" when it is signed in.
  A missing Claude Code still opens the row with **Install**, since every run goes through it.
- The Repositories page shows the Claude Code card only while Claude Code is missing or cannot be checked, never for a sign-in.
- The Claude sign-in happens where 0149 already asks for access: the connect card the first send on a Claude model opens, or **Settings → Providers**.
- `pickerEntries` in `src/lib/shared/providers/domain/model-catalog.ts` builds the picker's rows: Claude and every provider with a key list their models, and every other provider is one `chat-model-provider` row reading "<n> models, one key away" with `aria-expanded`.
  Opening that row lists its models below it, each still selectable with **No access**, and scrolls the row to the top of the list.
  The picker opens with the selected model's provider expanded and that model scrolled into view.
  A filter query searches every provider's models, folded or not.
- Sending on a folded provider's model opens 0149's connect card unchanged.

## Consequences

- Someone with only a DeepSeek or OpenCode account finishes onboarding, picks a model in the first chat, and connects at send; from then on 0152's last pick starts every new chat there.
- Someone with a Claude plan types their first prompt before the sign-in, one click either way.
- A provider added later costs the picker one row until it is connected, so the list stays short however large models.dev's catalog is.
- Enforced by `onboarding.test.ts` (an installed Claude Code settles the step signed in or not, a missing one does not), `model-catalog.test.ts` (unconnected providers fold until opened or searched), `tests/e2e/first-run.spec.ts` (a signed-out Claude Code passes setup with no sign-in button, Repositories shows no Claude card, the first send asks to sign in), and `tests/e2e/provider-models.spec.ts` (folded rows, opening one, filtering past the fold, the selected provider expanded on reopen).
