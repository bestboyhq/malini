# 0304 - The picker reaches every model a provider sells

Status: accepted

## Context

The user, on an OpenCode Go key: "there are some models that are available in open code that I cannot use right now because they just aren't in my picker", and "can we just fix that once for good?".
On 2026-11-25 OpenCode Go's own `GET /inference/go/v1/models` served 31 tool-calling chat models, and models.dev listed all 31 under `opencode-go`, yet Malini stored 22.
`modelsDevModels` dropped the other nine on read: four free models, such as HungerG Free released the day before, by 0157's rule that OpenCode keeps free models to its own apps, and five older versions of a line, such as Qwen3.8 Max behind Qwen4 Max and Hy3 behind Hy4, by 0160 and 0286.
A dropped version could not be picked at all, and `ProviderKeys.environment` refused one an automation still named with "OpenCode does not offer model".
OpenCode's anonymous answer for a free model outside its apps is now "Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going", and the user's Go key ran HungerG Free through Claude Code.
0283 already shows earlier Claude versions only when you search, a design the user picked, and `earlierVersions` in `model-catalog.ts` reads every provider's models, not only Claude's.

## Decision

- `modelsDevModels` in `src/lib/shared/providers/domain/models-dev.ts` keeps every model that passes the filter, once per label, newest first, with its `released` date when models.dev gives one as `YYYY-MM-DD`; `modelsDevVersions` is that list minus undated models.
- It keeps free models (input and output cost both 0) for `opencode-go` only; every other provider, OpenCode's Console list included, still leaves them out.
- The stored list of each provider is what it sells, so `pickerRows` still shows the newest model of each line, and `earlierVersions` lists the rest under **Earlier versions** when you search, with the month and the provider's icon, for OpenCode and DeepSeek as for Claude.
- **Settings → Providers** counts and names every model the provider sells, and `ProviderKeys.environment` runs any of them.
- No migration: the read at launch rewrites every stored list.
- This amends 0157 (free models), 0160 and 0286 (an older version dropped on read) and 0283 (earlier versions for Claude only).

## Consequences

- On models.dev of 2026-11-25, OpenCode Go lists 31 models instead of 22, the same 31 its own endpoint serves, and OpenCode Console 73 instead of 39.
- The picker's rows grow only by the free Go models; every older version stays out of the list until you type.
- A search such as `gpt` on Console lists many earlier versions, each from the provider that sells it.
- A free model can leave Go without notice; a run on it then fails with OpenCode's own error, and the next read drops it.
- Enforced by `models-dev.test.ts` (every version newest first, free models only for `opencode-go`), `model-catalog.test.ts` (an earlier OpenCode version found by search) and `tests/e2e/provider-models.spec.ts` (a Go key lists HungerG Free, finds Hy3 under **Earlier versions**, and names every Go model in Settings).
