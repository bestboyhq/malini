# 0233 - Browser MCP servers are hidden, and the browser reaches uploads, dialogs and frames

Status: accepted

## Context

0232 made Malini's browser the agent's only browser by instruction, but a user's own browser MCP servers, such as Playwright MCP or Chrome DevTools MCP, still offered the agent a second browser in every chat.
The user asked how to discourage them, and agreed to hide them, to refuse other browsers in Bash, to leave simulators and a project's own tests alone, and to block with no way back in this first version.
0232 also left file uploads, elements inside iframes and pages behind a JavaScript dialog out of reach, which are the cases that still sent an agent to another browser.
Electron replaces `window.prompt` in every page with a function that throws "prompt() is and will not be supported", so a page never opens a prompt dialog in Malini.

## Decision

- `isBrowserMcpServer` (`packages/agent-bridge/src/claude/browser-mcp.ts`) marks a server as a browser by the command or URL it launches (Playwright, Puppeteer, Selenium, Stagehand, Chrome DevTools MCP, Browserbase, Browser MCP, browser-use, Browserless, Hyperbrowser, MCP Chrome), by the name `claude-in-chrome`, or by tools that navigate, click and capture; a server named for iOS, Android, a simulator, an emulator, Appium or a device is never one.
- Before a chat's first prompt, once its MCP servers settle, the session denies `mcp__<server>` for each browser server through `applyFlagSettings`, sent with the run's allow rules so an **Always allow** does not drop it (`session.ts`).
- A `PreToolUse` hook refuses a call to a hidden server's tool with `BROWSER_MCP_REFUSAL`, which names Malini's browser tools, and checks the status again when the server connected after the chat started.
- `bridge.mcp_server` and `bridge.mcp_servers` reports carry `browser: true` for such a server (`mcp-servers.ts`); the chat's MCP panel lists it under **Browsers** as **Hidden** with no fix step, and Settings says it is hidden from agents (`McpStatusPanel.svelte`, `McpServersSettings.svelte`).
- `steerToMalini` (`permissions.ts`) refuses `agent-browser`, a Chrome or Chromium binary, `playwright open`, `codegen`, `screenshot`, `pdf`, `cr`, `ff` and `wk`, and `open` on a URL or an HTML file, also behind `npx`, `pnpm dlx` and other package runners, and names Malini's browser tools; `playwright test` and the rest of a project's tooling run as before.
- `browser_upload` picks files for a file input, or for the button that opens a file chooser, from paths inside the worktree only; `DOM.setFileInputFiles` sets them, and a click, press or key that opens a chooser outside `browser_upload` is cancelled with that hint (`automation.ts`).
- Malini takes Electron's private `-run-dialog` event from each browser tab (`electron-view.ts`): an alert or confirm on a tab the user sees while no agent acts on it shows Electron's own box as before, and any other is held for the agent.
- The tool whose action opened a held dialog returns its message, the other browser tools refuse until `browser_dialog` answers it, the answer waits for the interrupted action to finish, and navigation or a closed page drops it; a held dialog goes to the user once they show the tab.
- A page that asks to stay through `beforeunload` is left when an agent's tool navigates away.
- `browser_snapshot` reads into same-origin and cross-origin iframes, with refs such as `@f1e3`; out-of-process frames come from `Target.setAutoAttach` with `flatten`, each frame gets its own `Malini` isolated world, and a point in a frame is moved through each owner's box to the page.
- Protocol 58 carries the `upload` and `dialog` browser requests.
- The e2e harness lets `127.0.0.1` resolve beside `localhost`, so a test has a second origin for a cross-origin frame, and gives Playwright a dialog listener that does nothing, since Playwright otherwise dismisses every page dialog before Malini can answer it (`tests/e2e/harness.ts`).

## Consequences

- An agent in Malini never sees a browser MCP server's tools, and a user's terminal `claude` keeps them.
- A browser MCP server a user wants for one chat cannot be let back in; a way back waits for a real case, such as DevTools performance traces.
- A new browser MCP package that launches under a name the pattern misses stays visible until its tools match the navigate, click and capture test or the pattern learns its name.
- An agent no longer leaves Malini for an upload, a confirm dialog or a form inside an iframe, which amends the last consequence of 0232.
- A page that calls `prompt()` gets the error Electron throws, in Malini as in every Electron app.
- `-run-dialog` is not public Electron API, so an Electron upgrade can rename it.
- Enforced by `browser-mcp.test.ts`, `permissions.test.ts`, `session.test.ts` and `browser-tools.test.ts` in the agent bridge, `mcp-server.test.ts`, `views.test.ts`, `protocol.test.ts` and `service.test.ts` in the app, `tests/e2e/browser-tab.spec.ts`, which answers alerts and confirms, uploads through a field and a button, and drives same-origin and cross-origin frames, and `tests/e2e/mcp-servers.spec.ts`, which shows hidden browser servers in the panel and in Settings.
