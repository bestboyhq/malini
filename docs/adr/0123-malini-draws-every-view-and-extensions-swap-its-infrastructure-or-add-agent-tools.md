# 0123 - Malini draws every view, and extensions swap its infrastructure or add agent tools

Status: superseded by 0125

## Context

Power users asked for a plugin system for two cases: browsing a database's tables, and a remote environment for every workstream.
The user's constraint: "I would hate if Malini lost its magic ... as soon as someone comes and starts to ship their own UI that is just rendered within Malini, the user experience is not gonna be as good", and agent rules against it would still not be "a deterministic evaluation".
Extension API v1 cannot hold that line: a panel mounts into a raw `HTMLElement` inside the renderer (`mount` in `packages/extension-api/src/types.ts`), next to the whole `window.malini` bridge, and even the built-in Repository extension copies hyper-ui's look in about 7,000 lines of hand-built DOM.
The platforms that kept a native feel with thousands of extensions draw extension UI themselves (Raycast, Shopify, Stripe), while iframe and webview extensions drift from their host (Atlassian Custom UI, and VS Code's own advice to use webviews only when absolutely necessary).
On the database case the user found that "very often you just don't need UI to always be there": DBDeck already ships an MCP server, and a table is needed only while a task is, so "dynamic view rendering shouldn't be a plugin responsibility, it should be on Malini's side".
On secrets and dev boxes they saw one pattern: "I can swap my infrastructure layer in Malini ... from local to Cryptly", and "the user shouldn't give a fuck where the secrets sit".

## Decision

- Malini draws every pixel.
  No extension ships HTML, CSS or a component: an extension supplies data and actions in shapes Malini knows.
- Extensions come in two kinds:
  - **Adapters** swap a piece of Malini's infrastructure behind a port: where secrets live, where commands run, where jobs run.
    A port has one adapter at a time, chosen once in a repository's settings, and today's local behavior is the first adapter of each.
    An adapter has no UI: Malini draws its settings and status from a schema in its manifest.
    A third-party adapter is a manifest v2 (`apiVersion: 2`, `permissions`, `contributes.adapters`) whose operations are commands that print JSON, and it runs in its own child process under Anthropic's `sandbox-runtime`, limited to the paths and hosts it declares.
  - **Contributions** add what agents can do: MCP servers, skills and hooks, in the Claude Code plugin format, installed through Claude Code, any number at once.
    Claude Code holds their configuration and sign-ins, so one install works in every Malini chat and in the terminal.
- Views are summoned, not installed.
  An agent opens one with a `views_show` tool on the `malini` MCP server, as a spec of blocks from Malini's vocabulary (List, Tree, Table, Detail, Form, Code, Actions, layout and states), each bound to an MCP tool or resource that Malini calls itself.
  The model gets the spec and a sample of rows, never the whole result, and an action is an MCP tool call behind Malini's approvals.
  Malini joins several sources in the main process, so no two extensions compete to draw one view.
- The user never picks where something lives: every chat, job and view uses the adapter a repository's settings chose.
- The first port is secrets, with this Mac's keychain as its adapter (0124).
  The environment and the job runner keep their local behavior until their ports get a second adapter.
- An Extensions directory in the app lists both kinds; a Showcase of what people built with Malini is a separate directory.
- Unchanged: extension API v1 stays internal and first-party, no extension code runs in the renderer, there are no webviews, and there is no Malini server.
  A tool that ships an MCP App opens its HTML only as a browser tab, for servers built for other agent apps.

## Consequences

- An extension cannot drift from Malini's look, because it has nothing to draw with; a canvas such as an ER diagram waits until the vocabulary grows a block for it.
- A database client becomes an MCP server plus views on demand.
  DBDeck as it ships today cannot be listed, since its server lives inside the VS Code extension and runs only while the editor does.
- A port grows its interface when its second adapter arrives, such as Cryptly for secrets, so the keychain adapter stays a plain module until then.
- `views_show` needs Malini to call an MCP tool without a model turn.
  The Agent SDK's `mcp_call` control request (0.3.290) is not a method on `Query` yet, and the fallback, Malini's own MCP client on Claude Code's configuration, signs in to OAuth servers a second time.
- A child process is no sandbox by itself, so adapters run under `sandbox-runtime`, a research preview whose macOS backend sits on the deprecated `sandbox-exec`.
- Where the Showcase lives and what power users mean by a remote environment are still open.
- Nothing enforces "Malini draws every pixel" until manifest v2 exists: v1 stays first-party, and the v2 schema carries no field that could hold markup.
