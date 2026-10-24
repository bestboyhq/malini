# 0065 - Agents resize the browser by moving the inspector divider

Status: accepted

## Context

An agent sees a page at whatever width the user left the inspector, which can be too narrow for the layout it checks.
Emulating a viewport inside the panel, scaled to fit, was rejected by the user: a page that renders apart from its panel "will just go crazy" and "detach from the main window", which they called a horrible experience.
Rendering a hidden, offscreen copy at the asked width was rejected too: the user wants the agent to resize the browser tab they see, and nothing else.
The user worried a resize could swallow the chat or the sidebar, and that restoring the width afterwards would bring edge cases, so the first version restores nothing.

## Decision

- The agent gets `browser_resize` with a `width` in CSS pixels (`packages/agent-bridge/src/claude/browser-tools.ts`), sent as the bridge browser action `resize`; protocol 39.
- `BrowserViews.resize` (`src/lib/browser/platform/views.ts`) acts only on a tab that is shown while Malini is on screen; otherwise it changes nothing and tells the agent the page's width and why.
- For a shown tab it emits `browser:resize-requested` with the width in Malini's interface pixels and waits up to `RESIZE_ANSWER_MS`, 5 seconds, for `browser.resized`.
- In the renderer, `watchBrowserResizesHook` in that tab's `BrowserPanel` grows the inspector by the difference through `inspectorWidth` (`src/lib/shared/extensions/inspector-width.store.ts`), which `InspectorSplit` connects to `ResizableSplit.growSecondary`, places the view at its new bounds, then answers `browser.resized`.
- `growSecondary` clamps like a drag and saves the ratio like a drag: the chat keeps the split's minimum, 400 px beside browser tabs, the inspector keeps its minimum, the sidebar sits outside the split, and the width stays until the user drags it back.
- The agent hears the width the page got, and whether the chat's or the inspector's minimum stopped it.

## Consequences

- The page the agent captures is the page the user sees, at the same width, in the same panel.
- A resize never opens the inspector, switches its tab or changes another workstream, so the agent cannot resize a tab the user is not looking at.
- The resize jumps rather than eases, because an interrupted Svelte `Tween` never settles its promise and the answer to main must come once the view has its final bounds.
- Every browser tab shares one split ratio (`WORKSTREAM_BROWSER_RATIO_KEY`), so an agent's resize carries over to every workstream with browser tabs, as a drag does.
- Enforced by `views.test.ts` in `src/lib/browser/platform`, `protocol.test.ts` and `service.test.ts` in `src/lib/chat/platform/agent`, `browser-tools.test.ts` in the agent bridge, and `tests/e2e/browser-tab.spec.ts`, which resizes a tab to an exact width, to both limits, and leaves a tab out of sight alone.
