# 0304 - Widgets read APIs as you through OAuth

Status: accepted

## Context

0301 moved widget sources from scripts to MCP tools.
The first MCP widget broke within a day: a PostHog tile read "posthog has no tool `query-trends`." while the agent that made it had just called that tool.
MCP tool names and inputs are written for models and change with no version, a server's name is local to each teammate, `readOnly` is an optional hint, and every read started a Claude Code session.
Simon: "mby mcp wasnt the best option. im leaning towards api-first contracts with PATs".
A first cut read the vendor's HTTP API with a personal key pasted on the tile; Simon turned it down before it shipped: "as soon someone has to put in some keys or execute some commands or basically do anything that is not just interacting with UI or copy-pasting things, the user experience is broken".
He picked OAuth only: a vendor with no OAuth sign-in cannot back a tile.
This supersedes 0301 and amends 0302: the `mcp` source, its needs and **Add <server>** go.

## Decision

- A widget source is `http`, `github` or the built-in `plan`.
  In a widget file, `{ "http": { "url", "method"?, "headers"?, "body"?, "oauth"? }, "select"? }`, with `oauth` as `{ "scopes"?: [...] }`; `widget-files.ts` parses it, `sourceFile` writes it, and `WidgetSource` in `$contract/widgets` carries it as `kind: 'http'`.
  `url` is `https`, or `http` on `localhost`, `127.0.0.1` or `[::1]`, with no user name or password.
  `method` is `GET`, the default, or `POST`; only a `POST` takes a JSON object `body`, at most 16 KB; at most 20 headers, and none named `authorization`, `proxy-authorization` or `cookie`; at most 20 scopes.
- **Discovery**, in `widgets/platform/widget-oauth.ts`, the way MCP clients find a sign-in: RFC 9728 metadata at `<origin>/.well-known/oauth-protected-resource`, whose `resource` must share the API's origin, then RFC 8414 `oauth-authorization-server` or `openid-configuration` metadata of the first authorization server, whose `issuer` must match.
  Every endpoint is `https`, or `http` on loopback; a server without a registration endpoint, or one whose challenge methods leave out `S256`, has no sign-in Malini can use.
  `widgets_save` runs discovery for a widget with `oauth` and refuses one with no sign-in.
- **Sign-in** on **Connect**, through `widgets.connect`: RFC 7591 registration of a public client named Malini for each connect, with the exact redirect `http://127.0.0.1:<port>/callback` of a one-shot listener, then the authorization code flow with PKCE `S256`, a random `state` compared in constant time, the RFC 9207 `iss` check and the RFC 8707 `resource`.
  The default browser opens the authorize URL through `shell.openExternal`; the tile shows "Finish in your browser." and **Cancel** (`widgets.cancel-connect`).
  One sign-in runs at a time, a second **Connect** for the same site joins it, and it stops after 10 minutes.
  The scopes asked are those already granted plus the widget's.
- **Tokens.**
  The grant is sealed with `safeStorage` through the shell host and stored in `widget_connections (origin, sealed, connected_at)`, one per API origin, shared by every board (the migration at user version 122).
  It never goes in the secrets keychain of 0141, because a secret is set in every agent command's environment.
  `readWidgetSource` in `widget-sources.ts` sends it as `Authorization: Bearer` only to the origin of the widget's `url`, with `net.fetch`, `redirect: 'manual'`, 20 seconds and 5 MB, and shows the token in an error as `[secret]`.
  It renews 60 seconds before expiry, or once after a 401, one renewal per origin at a time; `invalid_grant`, `invalid_client` or `unauthorized_client` deletes the connection.
- **Needs.**
  `widget_readings.need` stores `{ "connect": "<site>" }`, and the tile and the chat's widget card show **Connect** beside "Reads <site> as you." or "Needs <scopes> on <site>.".
  A connect reads every watched widget on that origin.
- **No scripts, no MCP tools.**
  `widgets_save` and the bridge schema refuse `command` and `mcp`.
  A file with either still parses, as `kind: 'retired'`, so a placed one stays on the board and says "Widgets read APIs now, not scripts or MCP tools. Ask the agent to move this one."
  The bridge's `call_mcp_tool`, the chat platform's `callMcpTool` and the renderer's MCP fix commands go; the bridge protocol is version 63.
- The agent's instructions and the `widgets_save` description tell it to name `oauth` with read scopes, never to put a key or a token in a header, to learn the answer's shape from the API's docs or the service's MCP server, and to point the user at **Connect**.
- Malini does not check that a request only reads: the scopes the service grants do.
- `github` sources and the automation rule from 0301 stay: an automation whose internet is off may not save a widget.

## Consequences

- A tile reads with one HTTPS request from the main process: no bridge session, no model-facing tool names, and the vendor's own API versioning.
- Each teammate connects once per site with a click and a browser sign-in; nobody pastes a key, and a shared widget file holds no secret.
- A token reaches only its own API origin, so a teammate's widget on the default branch cannot carry it to another site.
- A service with no OAuth discovery and dynamic registration cannot be a widget, and the agent hears so at save time.
- A service whose OAuth tokens work on its MCP server but not on its REST API answers 401 after renewal, and the tile shows that error.
- There is no **Disconnect** yet; a sign-in ends when the service revokes it.
- The widget request, discovery, registration and token calls are outbound calls of the app; `AGENTS.md` lists them.
- Enforced by `src/lib/widgets/platform/register.test.ts` on real SQLite, git, jq and a local HTTP server with a fake authorization server (connect and read, the token only to its own site, renewal before expiry and after a 401, the masked error, a revoked grant, no sign-in, a denied sign-in, **Cancel**, a joined connect, the refused redirect, retired `command` and `mcp` files), `src/main/db/migrations.test.ts`, the widget domain tests, `packages/agent-bridge/src/claude/browser-tools.test.ts`, and `tests/e2e/widget-card.spec.ts`, `tests/e2e/widgets.spec.ts` and `tests/e2e/agent-actions.spec.ts` against `tests/e2e/fake-api.ts`.
