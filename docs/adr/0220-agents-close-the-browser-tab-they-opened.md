# 0220 - Agents close the browser tab they opened

Status: accepted

## Context

An agent opens a page in its own browser tab, `chat-<sessionId>` from `agentBrowserTabId`, to check or capture it, and that tab stayed open until the user closed it with its X.
Every checked page left a tab and a live page behind, so the inspector filled with pages the user never needed to see.
The user called closing them "the biggest change and the best improvement in the whole user experience", and the step that enables "more thoughtful collaboration with the user".
The agent must never close a tab the user opened.

## Decision

- The agent gets `browser_close`, with no input (`packages/agent-bridge/src/claude/browser-tools.ts`), sent as the bridge browser action `close`; protocol 54.
- `answerBrowserRequest` (`src/lib/chat/platform/agent/service.ts`) closes only the session's own tab, `agentBrowserTabId(sessionId)`, so no request can name a tab the user opened.
- `BrowserViews.close` (`src/lib/browser/platform/views.ts`) runs inside the tab's turn, so it closes after a page still opening, destroys the view when one exists, and always emits `browser:tab-closed` with `{ workstreamId, tabId }`.
  It emits even without a view, because after a restart the renderer lists the tab before its panel mounts one.
- The agent hears `Closed your browser tab and its page.`, or `You had no browser tab open, so nothing closed.` when main had no page for it.
- In the renderer, `removeClosedBrowserHook`, mounted in `AppShell.svelte`, runs `closeBrowserTabCommand`, the same command as the tab's X: the tab leaves the saved list, its page closes and its last address is forgotten.
- `closeBrowserTabCommand` loads the workstream's saved tabs first, so closing a tab of a workstream not opened this session keeps the user's other tabs.
- `maliniInstructions` tells the agent to close its tab once the page has served its purpose, and to keep it open only while the user should look at or use that page.

## Consequences

- A tab the agent opened to check something goes away on its own, and the tabs left are the ones the user or the agent wants looked at.
- Whether a page stays open is the agent's judgment, steered by its instructions; the user can still close any tab with its X.
- The next `browser_open` in the chat opens a fresh tab with the same id.
- `browser:tab-closed` fires only for the agent's close; the user's X closes its tab in the renderer and emits nothing.
- Enforced by `views.test.ts` in `src/lib/browser/platform`, `protocol.test.ts` and `service.test.ts` in `src/lib/chat/platform/agent`, `browser-tools.test.ts`, `session.test.ts` and `instructions.test.ts` in the agent bridge, and `tests/e2e/browser-tab.spec.ts`, where the agent closes its tab and page, the user's tab and page stay, and the agent's tab stays gone after a reload.
