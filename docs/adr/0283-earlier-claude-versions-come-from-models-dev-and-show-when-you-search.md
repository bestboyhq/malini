# 0283 - Earlier Claude versions come from models.dev and show when you search

Status: accepted

## Context

Claude Code's `supportedModels()` names only aliases such as `opus`, `sonnet` and `haiku`, each running the newest model of its family, so the picker could never offer an earlier Opus.
Some users want an earlier version of a family, to compare runs or keep a model they trust.
Of three prototypes (versions in search results, a flyout of versions per family, a fold at the end of the list), the user picked the search one, so the list everyone sees stays one row per family.
Claude Code passes any model id to the API, and a chat already keeps a picked model the list does not show as its own row under its family.
models.dev, which 0157 already reads hourly for the keyed providers, lists every Claude model under `anthropic`, with its release date, efforts and context, and marks retired ones `deprecated`.

## Decision

- `ModelsDevCatalog` (`src/lib/shared/providers/platform/models-dev.service.ts`) also reads `anthropic` from the same response through `modelsDevVersions` (`src/lib/shared/providers/domain/models-dev.ts`), and stores the result in `settings` under `claude-model-versions` whenever it lists at least one.
  No new outbound call: it is the same request, and the request still carries nothing but the ETag.
- `modelsDevVersions` applies `modelsDevModels`' filter, keeps every version once by label instead of one per family, drops " (latest)" from a name so the undated alias wins over its dated twin, and keeps only models with a `YYYY-MM-DD` release date, stored as `released` on `AgentModelInfo`.
- `providers.list` returns those versions as the Claude provider's models, and `providerGroups` appends them after Claude Code's own models through `withEarlierVersions`, only for families Claude Code offers and never for a label or id it already lists.
- `pickerRows` still shows one row per family; `earlierVersions` returns the versions a query matches, which the picker lists under **Earlier versions** with the month each came out, and Enter picks the first one when no row matches.
- Since the versions are Claude models, the model selects in Settings and the automation editor list them too, with their own efforts.

## Consequences

- An older Claude model shows up, and a retired one leaves, without a Malini release; a chat that still has a retired one keeps its id and Claude Code answers for it.
- A plan without a family hides that family's versions, since Claude Code does not list its alias.
- A models.dev outage keeps the last stored versions; an install that never reached models.dev has none.
- Enforced by `models-dev.test.ts` (one version per label, the undated alias, no deprecated or undated model), `models-dev.service.test.ts` (real SQLite: versions stored and kept when a later answer lists none), `model-catalog.test.ts` (families Claude Code offers, alias labels left out, versions only for a query, a picked version as its own row) and `tests/e2e/provider-models.spec.ts` (a local catalog, `opus` and `4.5` in the picker, Enter, and a run that starts with `claude-opus-4-5`).
