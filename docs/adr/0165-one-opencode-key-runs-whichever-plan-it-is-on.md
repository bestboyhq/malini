# 0165 - One OpenCode key runs whichever plan it is on

Status: accepted

## Context

0157 left OpenCode Go out: it would need a second key slot or a routing rule, and no Go key was at hand to prove its endpoint.
The user then asked to "not care if it's open code Go or console account", to paste one key and let Malini sort out the rest.
Go and Console sell overlapping but different model lists, so the plan decides which models the picker may offer and which base URL a run uses.
Both plans speak Anthropic Messages on one `oc_sk_` key, and a Go run goes to `https://opencode.ai/inference/go/anthropic`.
The models endpoints do not name the plan: a Console-only key at hand read `GET /inference/go/v1/models` and `GET /inference/v1/models` with 200 and both lists.
The Go inference endpoint does: with an `x-opencode-session` header, an invalid key is 401, a Console key is 403 "An active OpenCode Go subscription is required to use Go models.", and a Go key answers.
A model can answer 400 first, before entitlement, when its host lies outside the account's region or it trains on the account's data, and the list leads with two such models.

## Decision

- OpenCode stays one provider card and one API key field. There is no plan picker, no second OpenCode card, and no plan named in the model picker.
- `detectOpenCodePlan` (`src/lib/shared/providers/platform/opencode-plan.ts`) reads `GET <origin>/inference/go/v1/models`, then sends a message with `max_tokens: 1` to `POST <origin>/inference/go/anthropic/v1/messages` with the key as a bearer token, `anthropic-version`, and an `x-opencode-session` of `malini-<uuid>`, each with a ten-second timeout.
  It asks with `glm-5.3-flash` first, a model the default region serves, then up to four models from the list, skipping any that answers `400`.
  A `200` is `go`; a `403` is `console`; a `401` says "OpenCode did not accept this key."; a `429` leaves the plan unknown; any other status, five `400`s, or no answer says "Malini could not check this key with OpenCode. Try again."
- `ProviderKeys.save` probes only for `opencode`, before writing the sealed key, and stores the plan in `model_providers.plan`, added by migration 94 with `CHECK (plan IN ('console', 'go'))`; `NULL` means no key, a rate-limited check, or a key saved before plans existed.
- A key saved with an unknown plan stays saved and lists Console's models until a check succeeds; **Check again** next to the model count in **Settings → Providers** is offered whenever an OpenCode key is saved, and `providers.check-plan` replaces the plan only with an answer.
- Migration 94 also seeds a hidden `opencode-go` row, named OpenCode Go, kind `anthropic`, base URL `https://opencode.ai/inference/go/anthropic`, and the 22 Go models models.dev listed when the migration was written.
  `providers.list` hides that row and, for an OpenCode row on the Go plan, serves its base URL and models in place of the Console row's; `providers.save` and `providers.delete` refuse `opencode-go` by id.
  models.dev still replaces both rows' model lists, because both are stored `anthropic` providers it lists.
- `providers.refresh-models` calls `detectMissingPlan`, which probes a key with no plan once and swallows a failure, so the next picker open or Settings visit fills the plan in.
- The card names the plan only when it is Go: "Key saved. Your Go plan." A Console key keeps "API key saved on this Mac."
- `MALINI_OPENCODE_PROBE_URL` points an unpackaged build at another origin for the probe; a packaged build always uses `https://opencode.ai`.
- The probe is the app's sixth outbound call of its own, from `src/lib/shared/providers/platform/register.ts`, and carries the key, a session id and one token.

## Consequences

- A Go subscriber runs Go models at Go rates without choosing anything, and a Console user keeps Console's list; the only trace of the plan is one line under their key.
- Saving an OpenCode key or pressing **Check again** spends one token on a Go plan, and two requests unless a model is region-excluded, which adds up to four more.
- Before a key is saved the picker lists Console's models, so a Go user can pick a model only Console sells and be refused at send with "OpenCode does not offer model"; saving the key then opens the picker on the Go list.
- A key on both plans resolves to Go, and a plan OpenCode changes shows up only when the key is saved again or **Check again** is pressed; the models themselves still refresh hourly from models.dev.
- The Console classification is proven with the real key at hand; the Go classification is covered by fakes only, because that key is a Console key.
- Enforced by `opencode-plan.test.ts` (Go on 200, Console on 403, unknown on 429, refused on 401 at either step, no answer at either step, the model, session header and `anthropic-version` it sends, a region-excluded model skipped, five of them giving up, the fallback model, the env var in an unpackaged build), `provider-keys.service.test.ts` (the Go plan, models and endpoint; check again; a key with an unknown plan; legacy adoption; a refused replacement key keeping the old one; the hidden row refused), `migrations.test.ts` (the `plan` column and the seeded Go row), and `tests/e2e/provider-models.spec.ts` (a Console key lists Console models with its card copy; a Go key lists Go models, runs them on the Go endpoint, re-checks into Console and lists those models).
