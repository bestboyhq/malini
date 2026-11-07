# 0169 - A chat opens before its provider is connected

Status: accepted

## Context

0166 had `ProviderKeys.environment` check the ChatGPT sign-in for a new session, and 0148's environment needs a saved key, so `chat.start-session` threw `provider_not_ready` whenever the model's provider was not connected.
The user switched an Opus chat to a GPT model while signed out of ChatGPT, pressed **New chat** and got "Could not start agent chat · Sign in to ChatGPT in Settings, then try again."
They asked that "if my provider is not authorized, I should still be able to create a new chat and send the message", that the send is where "I should get prompted to authorize the provider", and that "we cannot block someone from creating new chat or work stream only because they are not signed into provider."
The same throw broke every caller of `chat.start-session`: **New chat**, forks, **Implement plan**, a job's chat and `workstreams_create`.
0149's rule that access is asked for at send, its connect card and 0166's proxy stay in force; this ADR replaces only 0166's sign-in check for a new session.

## Decision

- Opening a chat never waits on its provider.
  `startAgentSession`, `getOrCreateAgentSession` and `activateAgentSession` in `src/lib/chat/platform/agent/commands.ts` resolve the environment through `readyEnvironment`, which answers `null` when it cannot, and then save or keep the session without registering it with the bridge.
- The bridge learns such a session at its first send: `ensureSessionReady` registers it through `registerPersistedBridgeSession`, which resolves the environment again and fails the send with the provider's own message, such as "DeepSeek needs an API key. Add it in Settings, then try again.", when it is still not connected.
- `sessionOpening` in `src/lib/chat/platform/agent/sessions.ts` treats a session as `new` until it has a provider session id, so a conversation's first send is still refused on a model its provider does not offer, as 0165 relies on, and one that ran reopens on its model, as 0166 decided.
- A ChatGPT session's environment is the proxy's address and secret whether or not you are signed in: `SignedInProvider.endpoint` takes no session kind, and the proxy reads the token per request.
- `LifecycleError`'s `provider_not_ready` is deleted.
- `workstreams_create` starts the new chat on the provider of the chat that called it, not only its model, so a lead on DeepSeek or ChatGPT no longer starts a Claude chat with a model id Claude does not run.

## Consequences

- **New chat**, a fork, a job and a workstream open on any model, and the composer's connect card asks for the sign-in or key when you send, as it already did for a chat that had no session yet.
- A prompt that skips the composer, such as a job's or one `workstreams_create` delivers, fails at send with the provider's message instead of failing to open its chat.
- A session saved with its provider disconnected has no bridge state until it sends, so its MCP servers list once the provider connects.
- A ChatGPT run while signed out reaches the proxy, which answers 401 "Sign in to ChatGPT in Settings, then try again."
- Enforced by `tests/e2e/unconnected-provider-chat.spec.ts` (**New chat** on a signed-out ChatGPT model and on DeepSeek with no key, each opening without a toast and asking at send), `tests/e2e/chatgpt-provider.spec.ts` (a reopened chat keeps its model after ChatGPT drops it) and `tests/e2e/provider-models.spec.ts` (the key reaches a run's environment after the connect card), plus `provider-keys.service.test.ts` (a new session is refused a model the provider does not offer).
