# 0149 - The model is the choice, and access is asked for at send

Status: superseded by 0158

## Context

0148 grouped the model picker by provider and had the composer warn about the selected provider's readiness, which put the provider before the model and asked for setup before the user had a reason to connect anything.
A model is what the user chooses; a provider is plumbing that only matters when a run cannot start.
Asking at send time also reuses the connect UI that already exists in Settings, instead of adding a setup step to every model switch.
The provider identity, sealed key, per-run env and bootstrap scrub of 0148 stay in force; this ADR replaces only its picker grouping and composer gate.

## Decision

- `ModelProfilePicker` is one flat list of every model from every provider, with no group headers and no setup footer.
  Every row stays selectable without access; an unready row shows **No access**, a ready custom row shows **via <provider>**, and Claude rows carry no provider label.
- `modelAccess(selection, groups, claudeStatus)` in `$shared/providers/domain/provider.ts` is the one readiness rule.
  Claude is ready when the probe says ready, blocked only when it says missing or signed out, and treated as ready while the probe is checking or unknown so a slow probe never blocks a send.
  A custom provider is ready when its key is saved; otherwise the access names its id and display name, and an unknown provider falls back to its id.
- `ChatComposer` keeps Send available for any non-empty prompt.
  When the selected model is not ready, Send opens `ProviderConnectCard` above the composer instead of delivering: it echoes the prompt, titles itself **Send with <model>**, and asks only for that provider's key or a Claude sign-in, or points at **Settings → Providers** when Claude Code is missing.
  Connecting saves the key or finishes the sign-in and then sends the pending prompt, keeping the original queue or steer intent.
- Editing a past prompt passes the same gate in `ChatPromptBubble` before the checkpoint is armed and rewound, so a rewind cannot land on a run that cannot start.
- Changing the model or the draft scope closes an open connect card, so a card can never send with a different model than the one it names.

## Consequences

- The provider is asked for once, at the moment it is needed, and a Settings key saved earlier skips the card entirely.
- A model without access stays visible and selectable, which keeps the catalog honest about what exists.
- A Claude probe that is still running lets the send through; if the run then fails, its own error names the problem, which is cheaper than blocking every send while the probe starts.
- The keychain and Settings path are unchanged, and the connect card writes through the same `saveProviderKey` command.
- Enforced by `provider.test.ts` (the access matrix), `tests/e2e/provider-models.spec.ts` (flat list, **No access**, send opens the card, connecting sends with the DeepSeek env, Settings reads the saved key), and `tests/e2e/edit-resend.spec.ts` (the checkpoint path with access ready); the flat rendering itself is not asserted, per the no-rendering-test rule.
