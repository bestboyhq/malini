# 0234 - Malini's browser is the agent's only browser

Status: accepted

## Context

Agents kept leaving Malini's browser tools for `agent-browser`, Playwright MCP or a Chrome they launched, because the tools could not read a page as text, hover, press keys, scroll, wait, run JavaScript or read the console, and `browser_resize` refused a tab the user did not see.
Instructions outside Malini, such as a user's own browser automation notes, also name `agent-browser`.
That Chrome cannot start its own sandbox inside Malini's (0190), so each attempt failed and asked the user for access.
The exit card made it worse: it offered every grantable denial of the last 10 minutes (0191), so a Chrome launch listed `~/Library/Preferences/.wrangler` from another command, widened a grant to `~/Library/Application Support/Google`, which holds the Chrome profile, and listed the system log socket every Chromium writes to.
The user asked for a browser that meets the highest bar and for this problem never to come back.

## Decision

- The bridge offers `browser_snapshot`, `browser_hover`, `browser_press`, `browser_scroll`, `browser_wait`, `browser_evaluate` and `browser_console` beside the earlier tools, and `browser_screenshot` takes `fullPage` or a `selector` (`packages/agent-bridge/src/claude/browser-tools.ts`); protocol 58.
- `src/lib/browser/platform/automation.ts` drives the page over the DevTools protocol through `webContents.debugger`, with focus emulation on, so every tool works while the tab is out of sight.
- `browser_snapshot` reads the page as text with refs such as `@e3`, which every tool that takes a selector also takes (`page-programs.ts`).
- Clicks and hovers are real mouse events at the element's center, after it holds still for two polls and a hit test finds it on top, waiting up to `ACTION_WAIT_MS`, 5 seconds; a select, date or file field is refused with how to set it.
- `browser_press` sends real key events, with the macOS editing commands a Mac keyboard sends (`keyboard.ts`).
- `browser_evaluate` runs like the DevTools console: top-level `await` and a bare `return` work, and the result is serialized and cut at 30,000 characters.
- `browser_console` reads the last `MAX_CONSOLE_LINES`, 200, messages of each tab since its page loaded, each cut at `MAX_CONSOLE_TEXT`, 1,000 characters.
- A full-page screenshot stops at `FULL_PAGE_MAX_HEIGHT`, 16,384 px, and says how tall the page is.
- `browser_resize` on a tab the user does not see sets that tab's own view to the asked width and height, at most 3,840 px each, shows it behind Malini's opaque window until the page reports that size, and fails when it does not within 2 seconds; a tab the user sees still moves the divider (amends 0065).
- Malini's instructions say its browser tools replace `agent-browser`, Playwright MCP, Puppeteer and any Chrome an agent launches to look at a page, even where other instructions name one, and that another browser is only for a project's own tests or a browser the user names (`instructions.ts`).
- The exit card offers only what the sandbox blocked for that command, kept per command for its last 200 commands, in place of every denial of the last 10 minutes (amends 0191, `session.ts`).
- A grant never widens to a folder that holds credentials or your files: `sandboxGrant` stops one level below it or offers nothing, and `grantProblem` refuses it (`sandbox.ts`).
- Commands may send to the system log socket, `/private/var/run/syslog`.
- When a blocked process is Chrome or Chromium, the agent hears that opening folders does not let Chrome start its own sandbox, that Malini's browser tools look at pages, and that a project's tests pass `--no-sandbox` (`permissions.ts`).

## Consequences

- An agent does everything it used to launch Chrome for in the tab Malini already shows, and the user sees no card for it.
- A card lists only what the command the agent wants to rerun needs.
- The DevTools session stays attached to a page from the first tool that needs it until the page closes, so anything else that wants to debug that page has to share it.
- A hidden tab keeps the size an agent gave it until the user shows it, when the inspector sizes it again.
- File uploads, elements inside iframes and pages behind a JavaScript dialog stay out of reach; the tools say so.
- Enforced by `views.test.ts`, `keyboard.test.ts` in `src/lib/browser/platform`, `protocol.test.ts` and `service.test.ts` in `src/lib/chat/platform/agent`, `browser-tools.test.ts`, `instructions.test.ts`, `session.test.ts` and `sandbox.test.ts` in the agent bridge, and `tests/e2e/browser-tab.spec.ts`, which drives every new tool on a tab out of sight and checks a phone-size capture.
