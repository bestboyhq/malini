# 0160 - The picker lists each model once, and hides its providers behind it

Status: accepted

## Context

0158 folded every provider without a key into one row, and 0157 listed a model id under every provider that sells it, so the picker was organized by provider.
The user: "User intent is never to know about open code. Their intent is always to find a model", and "which provider will give them that is a completely secondary concern".
models.dev lists every version a provider still sells, so OpenCode alone put 72 models in the picker, Opus 4.5 to 4.8 among them, where the user wanted "only Opus 5.5".
The list also depended on the Mac: which keys were saved decided what folded, and each Mac held its own models.dev snapshot from its last read, so "every single user I talked with had different list of models than I".
A provider showed as text, "via DeepSeek", where the user wanted its icon.
Of three prototypes, the user picked "Pick the runner": one row per model, one provider icon, and a flyout listing who runs it.
This replaces 0158's fold and 0157's line that lists an id under each provider; 0158's onboarding without a sign-in, 0157's models.dev read and 0149's connect card at send stay in force.

## Decision

- `modelsDevModels` in `src/lib/shared/providers/domain/models-dev.ts` keeps only the newest model of each models.dev `family`, a model without one standing alone, and stores the family on `AgentModelInfo.family` in `$contract/agent.ts`.
  Labels drop a leading "Claude " and a trailing four-digit snapshot, so "Claude Opus 5.5" reads "Opus 5.5" and "DeepSeek V4.1 Flash 1017" reads "DeepSeek V4.1 Flash".
- Migration 93 rewrites the DeepSeek and OpenCode model lists with that reader's output for the models.dev catalog at the time, so a Mac that cannot reach models.dev shows the same rows.
- `pickerRows` in `src/lib/shared/providers/domain/model-catalog.ts` builds one `PickerRow` per family across all providers, each with every provider that runs it as a `PickerRunner`, Claude's families first.
  A Claude Code model takes its family from its id (`opus[1m]` is `claude-opus`), and a row takes its label from a catalog provider, so Opus reads "Opus 5.5" whatever Claude Code reports.
  A selection no row lists, such as an older version a chat still has, gets a row of its own after its family's row.
- `ModelProfilePicker` shows each row with the icon of the provider that runs it: the selected one, else the first that is ready, else the first.
  A row with more than one runner has a chevron, and hovering it, or pressing →, opens a `chat-model-runners` flyout headed "<model> runs on", which names each provider and what it needs: "Key saved", "Needs a key", "Your Claude plan", "Signed in", "Needs a sign-in" or "Needs Claude Code".
  In the flyout, ← or Escape closes it and returns focus to the row; Escape anywhere else closes the whole picker, since a hovered flyout is only a preview, so `Dropdown` in hyper-ui passes `closeOnEscape` to its layer.
  No row says **No access** or **via <provider>**; sending on a model nobody connected opens 0149's connect card.
- The filter matches the model's name, each runner's model id and each provider's name, and Enter picks the first row on its runner.
- The footer shows the model and effort it saves as a preset on a `Badge`, with the provider icon.

## Consequences

- Everyone sees the same rows, whatever they connected, and the list holds about 30 models instead of 78.
- An older version is reachable only while a chat or job still has it selected; picking it anew needs a provider that still lists it as its newest.
- A provider whose models.dev entry has no `family` shows every version it lists, since each stands alone.
- A Claude Code older than the catalog can run an older Opus under the row "Opus 5.5", since the alias names the family, not the version.
- Enforced by `models-dev.test.ts` (newest per family, short names), `model-catalog.test.ts` (one row per family, runner order, the selected row, labels, the filter), `migrations.test.ts` (the reseeded lists), and `tests/e2e/provider-models.spec.ts` (rows by model, the runner flyout by hover and keyboard, picking a runner, the OpenCode filter and Enter), `first-run.spec.ts` (a signed-out Claude reads "Needs a sign-in") and `model-picker.spec.ts` (labels and presets); no test asserts the icon or the badge's look, per the no-rendering-test rule.
