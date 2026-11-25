# 0303 - Widgets read APIs with keys bound to their sites

Status: accepted

## Context

0301 moved widget sources from scripts to MCP tools.
The first MCP widget broke within a day: a PostHog tile read "posthog has no tool `query-trends`." while the agent that made it had just called that tool.
MCP tool names and inputs are written for models and change with no version, a server's name is local to each teammate, the PostHog server only listed the tool with `?mode=tools&tools=…` in its URL, `readOnly` is an optional hint, and every read started a Claude Code session.
Simon: "mby mcp wasnt the best option. im leaning towards api-first contracts with PATs".
A vendor's HTTP API is the versioned contract the vendor supports, and a personal key pasted once on the tile, with a link to where to make it, meets the "frictionless sign-in" bar 0301 set.
This supersedes 0301 and amends 0302: the `mcp` source, its needs and **Add <server>** go.

## Decision

- A widget source is `http`, `github` or the built-in `plan`.
  In a widget file, `{ "http": { "url", "method"?, "headers"?, "body"?, "keyUrl"? }, "select"? }`; `widget-files.ts` parses it, `sourceFile` writes it, and `WidgetSource` in `$contract/widgets` carries it as `kind: 'http'`.
  `url` is `https`, or `http` on `localhost`, `127.0.0.1` or `[::1]`, with no user name or password.
  `method` is `GET`, the default, or `POST`; only a `POST` takes a JSON object `body`, at most 16 KB; at most 20 headers.
- **Keys.**
  A key appears only in a header value, as `${NAME}`, the name of a secret in the keychain (0141), for the repository or for everywhere.
  `widget_key_origins (board, name, origin)` lists the sites a board may send each key to.
  `widgets_save` allows the widget's own origin for every name it sends: the user asked for the widget, and the agent already holds the key in its environment.
  A key that is not saved, or not allowed for the widget's origin, stops the read before any request; `widget_readings.need` stores `{ "missing": [...] }` as JSON (the migration at user version 122 replaces the 0301 column).
  The tile shows a password field per missing name with **Save**, or **Allow <site>** when every key is saved, and **Get a key** opens `keyUrl` in the default browser, where the vendor sign-in lives, and keeps the board and its field in view.
  Both call `widgets.allow-keys`, which takes at most 10 values, only for names the widget sends, saves them with `SecretsPlatform.save`, allows the origin and reads.
- **Reading.**
  `readWidgetSource` in `widgets/platform/widget-sources.ts` fills the headers and sends the request with Electron's `net.fetch` from the main process, with `redirect: 'manual'`, so a 3xx is an error and a key never follows a redirect.
  It waits 20 seconds, reads at most 5 MB through `readBounded` in `$main/fs/download`, and shows every saved key value in an error as `[secret]`.
  `select` runs through `jq` as in 0301.
- A watched widget reads again on `secrets:saved` that names one of its keys while its last read failed, and on `secrets:deleted` of one of its keys.
- **No scripts, no MCP tools.**
  `widgets_save` and the bridge schema refuse `command` and `mcp`.
  A file with either still parses, as `kind: 'retired'` with a one-line description, so a placed one stays on the board and says "Widgets read APIs now, not scripts or MCP tools. Ask the agent to move this one."
  The bridge's `call_mcp_tool`, the chat platform's `callMcpTool` and the renderer's MCP fix commands go; the bridge protocol is version 63.
- The agent's instructions and the `widgets_save` description tell it to ask for the key with `secrets_request` before it saves, to ask for a key that can only read, and to send the request once with curl first so `select` fits.
- Malini does not check that a request only reads.
  The key's own scope does, such as a PostHog personal API key with only `query:read`, and the docs say so.
- `github` sources and the automation rule from 0301 stay: an automation whose internet is off may not save a widget.

## Consequences

- A tile reads with one HTTPS request from the main process: no bridge session, no model-facing tool names, and the vendor's own API versioning.
- Each teammate needs their own key for a shared widget, and pastes it on the tile once.
- A shared widget from the default branch cannot send a teammate's saved key anywhere they did not allow, and a renamed URL in a later commit asks again.
- An API that only signs in through OAuth cannot be a widget until Malini can run that sign-in.
- The widget request is a new outbound call of the app; `AGENTS.md` lists it.
- Enforced by `src/lib/widgets/platform/register.test.ts` on real SQLite, git, jq, the real secrets platform and a local HTTP server (the filled header and body, the need for a missing key, **Save**, a key held back from a second origin until allowed, the refused redirect, the masked error, retired `command` and `mcp` files, the re-read on `secrets:saved` and `secrets:deleted`), `src/main/db/migrations.test.ts`, the widget domain tests, `packages/agent-bridge/src/claude/browser-tools.test.ts` (the schema takes `http` and `github` and refuses `command` and `mcp`), and `tests/e2e/widget-card.spec.ts` and `tests/e2e/widgets.spec.ts` against `tests/e2e/fake-api.ts`.
