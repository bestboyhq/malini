# 0166 - A ChatGPT plan runs Claude Code through a private proxy

Status: superseded by 0177

## Context

Simon asked for their ChatGPT subscription "to be used in the Claude Code harness that Malini has, but just as model endpoint", without the Codex harness, and for the flow to stay the one he knows: pick a model, choose the provider, sign in, and see the provider "with usage and all" on the context card.
Claude Code speaks only the Anthropic Messages API, while a ChatGPT plan is spent through OpenAI's Responses API, and 0148 already left OpenAI-compatible endpoints out because they need a translation proxy.
Community proxies reuse the Codex CLI's login to call ChatGPT's private backend, which OpenAI's terms do not allow.
OpenAI's Sign in with ChatGPT lets a local app register itself on its first sign-in and spend the signed-in user's plan through `api.openai.com`, with an access token that lasts an hour and a refresh token that rotates.
A provider until now was a static key and base URL in the run's environment (0148, 0157), which an hourly token does not fit, and ChatGPT offers no API that reads a plan's usage.

## Decision

- `chatgpt` is a third provider kind beside `claude` and `anthropic`.
  Migration 95 rebuilds `model_providers` so a `chatgpt` row can never hold an API key, seeds `chatgpt` with base URL `https://api.openai.com/v1` and the models a Go plan's `/models` listed on 2026-11-06, GPT-6 Luna, GPT-5.6 Terra and GPT-5.6 Luna, and adds `chatgpt_account`, one row with the host id, the registered client id, the account's subject, email and name, and the sealed credentials.
- **Sign-in** is `providers.sign-in-to-chatgpt`, in `src/lib/shared/providers/platform/chatgpt/sign-in.ts`.
  It reads `https://auth.openai.com/.well-known/openid-configuration`, listens for the callback on `http://127.0.0.1:<random port>/auth/callback`, and opens the authorize URL in the browser with PKCE S256, `state`, `nonce`, `resource=https://api.openai.com/v1` and the scopes `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`.
  The first sign-in sends `client_id=dynamic_agent_client` with `agent_name_hint=Malini`, and Malini keeps the `oaiapp_…` client id the callback hands back.
  The id token is checked against the issuer's JWKS (RS256, issuer, audience, nonce, expiry) before anything is stored.
  Tokens are sealed with `SecretCipher` in `chatgpt_account.credentials`, refreshed when they expire or the API answers 401, and `providers.sign-out-of-chatgpt` revokes the refresh token and clears them.
- **Models** come from `GET https://api.openai.com/v1/models` with the account's token, after sign-in and at most hourly on `providers.refresh-models`, keeping those with `visibility: "list"` that the API serves.
  Sign-in returns only once that list is stored, so the prompt that waited on the sign-in is checked against the plan's own models.
  A `display_name` such as `GPT-6-Luna` reads `GPT-6 Luna`, the way models.dev names the same model.
- **The proxy** is `ChatGptProxy` in `platform/chatgpt/proxy.ts`: an HTTP server on `127.0.0.1`, on a random port, started by the first ChatGPT run.
  A ChatGPT run gets 0148's environment with `ANTHROPIC_BASE_URL` set to the proxy and `ANTHROPIC_AUTH_TOKEN` set to a 32-byte secret made at launch, so the ChatGPT token never leaves the main process.
  The proxy answers only a request whose `Host` is `127.0.0.1:<port>` and whose bearer matches the secret in constant time, so neither a web page nor another program on the Mac can spend the plan.
- **Translation** is `platform/chatgpt/translate.ts`: pure functions typed with `@anthropic-ai/sdk` and `openai` (dev dependencies, imported as types only), zod at both boundaries, and every `switch` ending in a `never` check.
  A Messages request becomes `POST /responses` with `store: false`, `stream: true`, the system prompt as `instructions`, the effort as `reasoning.effort` with `summary: "auto"`, `include: ["reasoning.encrypted_content"]`, and `prompt_cache_key` set to Claude Code's `x-claude-code-session-id`, which also goes out as `session-id`.
  It sends no `temperature` and no `max_output_tokens`, which the endpoint refuses, and drops Claude Code's server tools such as web search, which only Anthropic runs.
  The body goes zstd-compressed with `user-agent: Malini/<version>`; Malini names itself and sends none of the Codex CLI's `originator` or `x-codex-*` headers.
  The Responses stream comes back as Anthropic stream events; a reasoning summary becomes a thinking block whose signature carries the encrypted reasoning after `malini-chatgpt-reasoning:`, so the next turn hands it back as a reasoning item.
- **Errors:** a 401 retries once with a refreshed token, and a usage limit comes back as a 429 `rate_limit_error` with `x-should-retry: false` and "You hit your ChatGPT usage limit.", so Claude Code stops instead of retrying, and Malini pauses the turn as a rate limit (0100), since ChatGPT does not say when the limit resets.
  OpenAI refuses a model the plan does not include with a 400 `model_not_found`, and the proxy answers it as a 404 `not_found_error` with "Your ChatGPT plan does not include this model.", which Claude Code reports as `model_not_found`, so Malini fails the turn instead of pausing it.
  Only a refused refresh says "Your ChatGPT sign-in expired. Sign in again."; a token endpoint that refuses a fresh code says "ChatGPT turned down the sign-in (<code>).", since nothing had expired.
  The account notes when it hit the limit and clears it on the next answer.
- **The flow:** the ChatGPT group is ready once signed in, and `modelAccess` answers `chatgpt-signed-out` until then, and `chatgpt-model-missing` while the plan's list lacks the selected model, which keeps the prompt and shows "Your ChatGPT plan does not include this model." on the connect card.
  A chat reopens on its model even after the provider stopped listing it or ChatGPT signed out, because `ProviderKeys.environment` checks the list and the sign-in only for a new session; the composer's check then stops the send, where the picker can switch models, instead of an "Agent session unavailable" card that locks the picker.
  The picker's flyout names ChatGPT "Your ChatGPT plan" or "Needs a sign-in"; the connect card and Settings, Providers sign in with **Continue with ChatGPT**.
  The context card's **Providers** shows a **ChatGPT account** row with the email, "Using ChatGPT plan" or the usage limit line, and **Manage usage**, which opens `https://chatgpt.com/settings/usage`.
  It shows no bars and no run cost, since ChatGPT reports neither.
- **0160's rows:** a row that runs the selected model is named after what the selected provider runs, else after its first ready provider other than Claude, which is the one a pick runs, else after its first provider other than Claude, because ChatGPT and OpenCode can disagree on the newest model of a family.
  A model its provider dropped keeps the name another provider lists it under.
- **Jobs** get no gate of their own: picking a ChatGPT model for a job and turning on its trigger is the consent to spend the plan on it.
- `MALINI_CHATGPT_ISSUER` and `MALINI_CHATGPT_RESOURCE` point an unpackaged build at another issuer and API, which the e2e fake uses; a packaged build ignores them.

## Consequences

- A ChatGPT plan runs Claude Code's own tools, subagents and plan mode in Malini, with the same picker, connect card and Settings as every other provider.
- Malini makes a sixth outbound call of its own: `auth.openai.com` and `api.openai.com`, only after **Continue with ChatGPT**.
- Anthropic-only features do not carry over: server tools such as web search, and Anthropic's prompt caching, which OpenAI's `prompt_cache_key` stands in for.
- The thinking shown is OpenAI's reasoning summary, not the model's raw reasoning.
- Usage is a limit line and a link, not bars, until OpenAI offers a usage API.
- zod in the main bundle adds about 250 KB.
- Sign in with ChatGPT is a preview, so its endpoints, scopes and terms can change under Malini.
- A plan runs only the GPT models OpenAI lists for it: a Go plan listed three and refused GPT-6.1 Sol, which OpenCode serves.
- A Free plan cannot connect: OpenAI's consent page says "A required permission is unavailable. You can't continue with this workspace and plan." and offers Upgrade instead of Continue.
- Must stay true: the ChatGPT token stays in the main process, the proxy answers only its own host and secret, and the translator handles every block and event type its SDK types name.
- Enforced by `pnpm check` (the `never` checks), `translate.test.ts` (requests, streams, reasoning round trips, errors), `chatgpt.test.ts` (sign-in against a fake OpenAI, sealed tokens on real SQLite, refresh, revoke, the models stored before sign-in returns, the proxy's host and secret, the refused model's 404), `provider.test.ts` (`chatgpt-signed-out`, `chatgpt-model-missing`), `provider-keys.service.test.ts` (a reopened session keeps a dropped model), `model-catalog.test.ts` (the row named after the provider a pick runs, a dropped model's name), `migrations.test.ts` (migration 94), and `tests/e2e/chatgpt-provider.spec.ts` (the whole flow in the built app, and the chat reopened after a relaunch, a sign-out and a plan that dropped its model).
