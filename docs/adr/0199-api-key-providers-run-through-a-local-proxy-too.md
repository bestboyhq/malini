# 0199 - API-key providers run through a local proxy too

Status: accepted

## Context

0148 put a custom provider's real API key in `ANTHROPIC_AUTH_TOKEN`, so the bridge's command line, Claude Code and every command the agent ran held it.
The sandbox (0167) masks secrets in output only, so a command that a page tricked the agent into running could send the key away, and the key works from anywhere.
Asked whether secrets in Malini are safe, Simon asked "Could we make it more secure?", saw the key's path drawn before and after, and answered "Oh yes, sounds good."
0166 already kept a ChatGPT token out of Claude Code with a proxy on `127.0.0.1` that answers only its own host and a secret made at launch.
DeepSeek and OpenCode speak the Anthropic Messages API, so the same proxy shape needs no translation for them, only the key swapped.

## Decision

- `platform/local-endpoint.ts` holds what both proxies share: `LocalEndpoint` listens on `127.0.0.1` on a random port, makes a 32-byte secret, answers 401 "Malini did not recognize this caller." with `x-should-retry: false` to any request whose `Host` is not `127.0.0.1:<port>` or whose bearer or `x-api-key` does not match in constant time, caps a body at 64 MB and times a request out after 10 minutes.
  `ChatGptProxy` now runs on it with no change in behavior.
- `KeyProxy` in `platform/key-proxy.ts` is a second `LocalEndpoint`, with its own port and secret, started by the first run of an API-key provider and stopped with the providers module.
  `ProviderKeys.environment` gives an `anthropic` provider `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>/<providerId>` and `ANTHROPIC_AUTH_TOKEN=<secret>`, so Claude Code, the bridge and every command hold only the local secret.
- The proxy forwards only `POST /<providerId>/v1/messages` and `POST /<providerId>/v1/messages/count_tokens`, query string kept, to the provider's base URL by string concatenation; any other path or method answers 404, so the real key reaches no other endpoint on the provider's host.
- Each request resolves the key again through `ProviderKeys.upstream(providerId)`: the base URL the key's plan is served from (0165) and the decrypted key.
  A provider with no key answers 401 with the line Malini already shows, "OpenCode needs an API key. Add it in Settings, then try again.", so deleting a key cuts off running chats at once.
- Upstream gets only `accept`, `content-type`, `user-agent`, `anthropic-*` and `x-*` headers other than `x-api-key`, plus `authorization: Bearer <real key>`, with `redirect: 'error'`.
  The answer streams back with its status and headers, less the hop-by-hop ones and `content-encoding`, since `fetch` already decoded the body.
- A network failure destroys the socket, so Claude Code reports and retries it as its own connection error.

## Consequences

- The real key lives only in the main process: never in the bridge's command line, Claude Code's environment, a command or a log.
- A command can still spend the provider's credit through the local secret, but only on this Mac and only while Malini runs; the secret changes at every launch.
- One secret covers every API-key provider, so a command in a DeepSeek chat can reach an OpenCode key through the proxy too.
- Secrets saved for a repository (0141) still reach every command, and a command can still reach any host; a host allowlist is a later decision.
- Malini makes a ninth outbound call of its own: the requests Claude Code sent to DeepSeek and OpenCode now leave from the main process, so a firewall sees Malini make them.
- Must stay true: the real key never enters a run's environment, the proxy answers only its own host and secret, and it forwards only the two Messages paths.
- Enforced by `key-proxy.test.ts` (the forwarded path, query, headers and real key, a streamed answer, a 429 passed back, the 401 for a stranger and for a missing key, the 404 for other paths, methods and dot segments, and no upstream call for any refusal), `provider-keys.service.test.ts` (the local URL and secret in the environment, `upstream` on the Go plan's base URL, refused after a deleted key and for ChatGPT), `chatgpt.test.ts` (the shared host and secret check), and `tests/e2e/provider-models.spec.ts` and `tests/e2e/unconnected-provider-chat.spec.ts` (a run's environment holds the local URL and no real key, and the real key does not open the proxy).
