# 0157 - Provider models come from models.dev, and OpenCode joins them

Status: superseded by 0164

## Context

0148 hardcoded DeepSeek's two models in migration 88 and left OpenCode out, on the belief that OpenCode needs a translation proxy to speak the Anthropic Messages API Claude Code calls.
The user asked for their OpenCode subscription, "so its not just deepseek platform or claude sub", and for models.dev, "cause they're keeping it up to date".
OpenCode sells two things on one `oc_sk_` key: Go, a subscription to a curated set of models at `https://opencode.ai/inference/go/anthropic`, and Console, formerly Zen, which charges credits per request at `https://opencode.ai/inference/anthropic`.
Both speak Anthropic Messages for every model they sell, so GLM, Kimi and GPT all ran Bash through Claude Code on the user's key, with no proxy.
The user's key ran on Console, while Go refused it with "An active OpenCode Go subscription is required", and the user found two OpenCode providers with the same key confusing.
models.dev publishes every provider's models under the ids Malini uses (`deepseek`, `opencode`) and answers `If-None-Match` with 304.
A list written into a migration is stale by the next release, and the same model id now exists under several providers, so 0148's rule of showing an id once hid all but one of them.

## Decision

- Migration 92 seeds `opencode`, named OpenCode, kind `anthropic`, base URL `https://opencode.ai/inference/anthropic`, no key, no subagent model, and the 72 models models.dev listed for it when the migration was written.
- OpenCode Go is not a provider: a Go plan would need a second key slot or a routing rule, and no key at hand had one to prove it.
- `ModelsDevCatalog` (`src/lib/shared/providers/platform/models-dev.service.ts`) reads `https://models.dev/api.json` through Electron's `net.fetch` at launch and when `providers.refresh-models` runs, which the model picker and **Settings → Providers** call as they open.
  It reads at most once an hour after models.dev answers, sends the last ETag, gives up after 30 seconds or 32 MB, and swallows every failure, so the last list stays and the next open asks again.
  `providers.refresh-models` waits for that read and returns the providers, and `providers.list` stays a plain read of SQLite.
- `modelsDevModels` (`src/lib/shared/providers/domain/models-dev.ts`) is the only reader of that untrusted JSON.
  It keeps a model that calls tools, outputs text, is not deprecated, is not free (input and output cost both 0) and has a valid model id, whichever API models.dev says serves it.
  It takes the model's name as the label, describes its input and context ("Text and images, 1M context"), takes its efforts from `reasoning_options`, and sorts newest first, at most 200.
  Free models are left out because OpenCode refuses them to clients other than its own.
- The read replaces the model list of every stored `anthropic` provider models.dev lists with at least one model; a provider it does not list keeps its own.
- A provider's subagent model applies only while that provider still lists it; otherwise subagents run on the chat model.
- Labels and efforts are looked up in the selection's own provider (`selectionLabel`, `selectionModels` in `model-catalog.ts`), and the picker lists an id under every provider that sells it, so Claude Opus 5.5 shows from Claude and **via OpenCode**.
- The picker opens with a **Filter models** field focused; every typed term must appear in the model's name, id or provider, and Enter picks the first row.
- `PROVIDER_KEY_URLS` in `provider.ts` gives each keyed provider a **Get a key** link, in the connect card and in Settings, and OpenCode's points at `https://opencode.ai/console`.
- `MALINI_MODELS_DEV_URL` points an unpackaged build at another catalog; a packaged build ignores it.
- models.dev is the app's fifth outbound call of its own, and the request carries nothing but the ETag.

## Consequences

- A model a provider adds shows up without a Malini release, and a model models.dev drops leaves the picker; a chat or job that still has it selected keeps its id and the provider answers for it.
- A wrong models.dev entry can list a model the provider rejects, and the run's own error names it; malformed JSON changes nothing.
- An OpenCode Go subscriber pays Console rates in Malini until Go gets its own routing.
- Adding another Anthropic-compatible provider is one seeded row with an id models.dev uses.
- Enforced by `models-dev.test.ts` (the filter, labels, efforts and order), `models-dev.service.test.ts` (real SQLite: models replaced, unlisted provider kept, the hourly throttle with the ETag, a retry after no answer, the seed kept on bad JSON), `provider-keys.service.test.ts` (the OpenCode env and the subagent fallback), `migrations.test.ts` (the seeded rows), `model-catalog.test.ts` (the picker filter), and `tests/e2e/provider-models.spec.ts` (a local catalog replaces OpenCode's models, the filter and Enter, the connect card's key link, the OpenCode env, one catalog request per hour).
