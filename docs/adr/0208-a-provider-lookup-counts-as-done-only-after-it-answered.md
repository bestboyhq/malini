# 0208 - A provider lookup counts as done only after it answered

Status: accepted

## Context

0165 has `providers.refresh-models` call `detectMissingPlan`, which it says "probes a key with no plan once and swallows a failure", but the code probed on every refresh while the plan stayed unknown, a `GET` and up to five one-token messages to opencode.ai each time the model picker or Settings, Providers opened, even while OpenCode answered `429`.
A probe for a key that was replaced while it ran stored its plan on the newer key, since `setProviderPlan` matched only the provider.
0166 reads ChatGPT's models "after sign-in and at most hourly on `providers.refresh-models`", but `refreshModels` set the hour before it asked, so a listing that failed kept the old list for an hour.
A signing-key load that could not reach ChatGPT stayed cached as a rejected promise, so every later ID-token check failed until Malini restarted.
0157's models.dev catalog already asks again on the next refresh after a failure and stays as it is; 0165 and 0166 keep their status, and only what is said here changes.

## Decision

- **OpenCode plan.** `ProviderKeys` in `src/lib/shared/providers/platform/provider-keys.service.ts` keeps `#planUnknownAt` in memory: `#askPlan` sets it when a probe answers no plan or throws, and clears it when a probe answers one.
  `detectMissingPlan` skips the probe while that time is less than `PLAN_RETRY_MS`, one hour, old; `save` and **Check again** (`providers.check-plan`) always probe.
- `#adoptPlan` passes the sealed key it read to `setProviderPlan` in `provider.repository.ts`, which updates `model_providers` only `WHERE id = ? AND kind = 'anthropic' AND api_key = ?`, so an answer about a key that was replaced meanwhile stores nothing.
- **ChatGPT models.** `ChatGptAccount.refreshModels` in `platform/chatgpt/account.service.ts` sets `#modelsCheckedAt` only after `GET <resource>/models` answers OK with JSON, so it asks again at most hourly after an answer and on the next refresh after a failure.
  A refresh that comes while a listing is in flight waits for that listing (`#listing`), so concurrent refreshes, such as the one at launch and the picker's, share one request.
  Sign-in still clears the hour and returns once the list is stored, as 0166 says.
- **Signing keys.** `ChatGptAuth.#signingKey` in `platform/chatgpt/sign-in.ts` reads a cached load that failed as no keys and loads them again, so the next ID-token check asks again.
- **models.dev.** `ModelsDevCatalog` in `models-dev.service.ts` sets its hour only after a `304` or a catalog it parsed, so an answer it cannot read also asks again on the next refresh, as 0157 says.
- Every lookup goes where it went before: opencode.ai, `GET <resource>/models` on api.openai.com, the issuer's `jwks_uri`, and models.dev.
  The ChatGPT token never leaves the main process, as 0166 has it.

## Consequences

- A key that OpenCode will not place costs at most one probe an hour from the picker and Settings, and one more after each restart, since the time lives in memory; **Check again** still asks at once.
- A key saved while an older key's check runs keeps its own plan.
- A ChatGPT listing that fails asks again on the next picker open or Settings visit, with no backoff, so an outage costs one request of up to 30 seconds per refresh.
- A signing-key load that failed costs one more request at the next ID-token check instead of failing every check until a restart.
- What must stay true: none of these lookups records its time before an answer, and `setProviderPlan` matches the sealed key.
- Enforced by `src/lib/shared/providers/platform/provider-keys.service.test.ts` ('asks OpenCode about a key it would not place at most once an hour', which covers an answer with no plan but not a probe that throws, and 'keeps the plan of a key saved while an older key was still being checked'), `src/lib/shared/providers/platform/chatgpt/chatgpt.test.ts` ('lists the models again an hour after ChatGPT answered, and on the next refresh when it did not', 'loads the signing keys again after ChatGPT could not be reached for them') and `src/lib/shared/providers/platform/models-dev.service.test.ts` ('asks again on the next refresh when models.dev sent something unreadable').
