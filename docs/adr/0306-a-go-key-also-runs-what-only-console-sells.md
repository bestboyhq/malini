# 0306 - A Go key also runs what only Console sells

Status: accepted

## Context

The user, on an OpenCode Go key: "one huge problem is that I'm not seeing Gemini neon, for example, or other Gemini models".
On 2026-11-25 OpenCode's own `GET /inference/go/v1/models` served one Gemini chat model, Gemini 4 Argon, and `GET /inference/v1/models` served Gemini 4 Neon, Carbon, Hydrogen, Argon and five Flash models; models.dev lists them the same way under `opencode-go` and `opencode`.
0165 served a Go key the `opencode-go` row's models and base URL in place of the Console row's, so every model only Console sells was out of reach.
Asked whether a Go key should also list Console's pay-as-you-go models, which bill the Console credits per token, the user picked "List Zen too".
OpenCode Zen is the service behind Console's credits; Malini keeps calling it Console, as 0165 does.

## Decision

- `ProviderKeys` in `src/lib/shared/providers/platform/provider-keys.service.ts` keeps one OpenCode provider and one key; its sellers are the hidden `opencode-go` row, then the `opencode` row, when the key is on Go, and the `opencode` row alone otherwise.
- `providers.list` serves the sellers' models merged by `newestModels` in `model-catalog.ts`: each id once, from the first seller that sells it, newest first, so a model both plans sell runs on Go.
  The base URL it shows stays Go's.
- `environment` runs a model on the first seller that sells it: Claude Code gets the key proxy at `/opencode-go` for a Go model and at `/opencode` for a model only Console sells, and the subagent model comes from that seller's row.
- `upstream('opencode-go')` answers Go's base URL with the OpenCode key, only while the key is on Go, and `upstream('opencode')` always answers Console's base URL.
- The picker names no plan: a Console-only model looks like any other OpenCode model.
- This amends 0165, which served a Go key only Go's models.

## Consequences

- A Go key on models.dev of 2026-11-25 lists 89 models instead of 31: Go's 31 and the 58 only Console sells.
- A model only Console sells spends Console credits even on a Go key; with none left, the run fails with OpenCode's own error.
- The Go usage gauge still shows for every OpenCode model on a Go key, a Console-only one included.
- Enforced by `provider-keys.service.test.ts` (Go and Console models on a Go key, each run on its seller's endpoint, `opencode-go` refused once the key is gone), `model-catalog.test.ts` (`newestModels` keeps the first seller and sorts newest first) and `tests/e2e/provider-models.spec.ts` (a Go key lists Kimi K4, which only Console sells, runs GLM-6 at `/opencode-go` and Kimi K4 at `/opencode`).
