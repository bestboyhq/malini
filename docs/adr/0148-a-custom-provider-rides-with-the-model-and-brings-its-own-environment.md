# 0148 - A custom provider rides with the model and brings its own environment

Status: accepted

## Context

Malini drove Claude Code on the Claude sign-in this Mac already had, and a model was a bare id such as `opus`; the bridge passed `process.env` through and Claude Code chose its own endpoint and sign-in.
The Mac that runs Malini is temporarily launched with a bootstrap that points every run at DeepSeek through `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, the three `ANTHROPIC_DEFAULT_*_MODEL` values and `CLAUDE_CODE_SUBAGENT_MODEL`, and no part of the product may depend on it.
A provider's endpoint and key are per-run choices, not machine settings, and the same model id could exist under two providers, so a model string alone no longer says which key and endpoint a run uses.
Claude runs must keep OAuth and the parked-account switching of 0072, which breaks if provider variables leak in from the machine.
The API key must never sit in SQLite in clear text, in a log, an event, stats or an error message.

## Decision

- `$shared/providers` owns a provider: `claude`, built in and still authenticated by Claude Code's own sign-in, and custom Anthropic-compatible providers stored in `model_providers` (migration 88).
  Each row holds its id, name, kind, base URL, a nullable sealed API key, its model list and an optional subagent model.
- The migration seeds `deepseek` with base URL `https://api.deepseek.com/anthropic` and exactly `deepseek-v4-pro` ("Text only, best for complex work") and `deepseek-flash` ("Text and images, faster"), both at low, high and max effort, and sets `deepseek-flash` as its subagent model.
- A model is now `{ provider, model }` in `ModelSelection`, the renderer's model memory and chat snapshots, `agent_sessions.provider`, `job_definitions.provider`, `job_setups.provider` and `job_experiments.provider`.
  The migration adds each column with default `claude`, and turns a bootstrap-era row whose model is one of the two DeepSeek ids into `deepseek`; every other existing row stays Claude, and a stored selection without a provider gets the provider whose catalog lists its model, else Claude.
- The picker groups by provider: Claude from the capabilities probe, then each custom provider, and an id listed twice shows once.
  A custom provider is ready when its key is saved; Claude is ready when Claude Code is installed and signed in, and the composer warns only about the selected provider, so a DeepSeek chat does not wait on a Claude sign-in.
- `ProviderKeys` (`src/lib/shared/providers/platform/provider-keys.service.ts`) seals the key with Electron's `safeStorage` through the existing `SecretCipher` and stores the sealed bytes in `model_providers.api_key`.
  Settings, Providers takes the key in a write-only field; no command returns it, and errors name the provider, never the value.
- For each run the main process resolves `keys.environment(provider, model)`: `{}` for Claude, and for a custom provider the full env `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_MODEL`, the three `ANTHROPIC_DEFAULT_*_MODEL`, and `CLAUDE_CODE_SUBAGENT_MODEL`.
  The environment rides on `start_session`, `suggest_title` and `choose` (protocol 47), so a chat title and a choice run on the same provider as the chat.
- `claudeEnvironment(providerEnvironment)` builds the child env from `process.env` without `MALINI_*`, `AGENT_BRIDGE_LOG`, every `ANTHROPIC_*`, `CLAUDE_CODE_SUBAGENT_MODEL` and `CLAUDE_CODE_EFFORT_LEVEL`, then applies the provider env last.
  The capabilities probe uses the same scrub with no provider env, so the Claude group reflects this Mac's sign-in, not the bootstrap.
- A Claude run sends no provider variables, which keeps OAuth and account switching (0072) working.
- DeepSeek V4 Pro is text only and V4 Flash accepts images; Malini does not gate the composer on that yet.
- OpenAI-compatible endpoints and OpenCode Zen are out of scope: they need a translation proxy to speak the Anthropic Messages API Claude Code calls.

## Consequences

- Claude runs behave as before even while the machine's bootstrap is set, and DeepSeek runs use only the key saved in Settings.
- The plaintext key exists in main-process memory, in the command line written to the bridge, and in the child's environment, where Claude Code needs it; it is never in SQLite, a log, an event, stats or an error message.
- A provider is part of every place a model is stored, so a chat, job or default that moves between providers keeps its endpoint with it; existing rows and snapshots still open.
- Every custom provider must speak the Anthropic Messages API and accept the same model ids Claude Code sends.
- The subagent model is fixed per provider, so subagents on DeepSeek always run Flash.
- Enforced by `provider-env.test.ts` (the exact env), `provider-keys.service.test.ts` (real SQLite, sealed bytes, no command returning a value), `model-preferences.storage.test.ts` (provider inference for old snapshots), `session.test.ts` (bootstrap vars stripped, selected vars applied last), `migrations.test.ts` (migration 88, the seeded row, the provider columns), `protocol.test.ts` (`env` validation), and `tests/e2e/provider-models.spec.ts` (both groups, persistence, DeepSeek env, Claude `{}`).
