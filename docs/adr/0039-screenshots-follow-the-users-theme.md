# 0039 - Screenshots follow the user's theme

Status: accepted

## Context

The user works in dark mode and saw the agent report a light screenshot of Malini: "Could we make it a default to present screenshots in a theme user is currently using? not even just malini's screenshots, but overall, of any system/app a user is building".
Malini's theme lived only in the renderer's `localStorage`, so the main process, the browser tabs and the agent never knew it.
Electron's `nativeTheme` followed the system, so a user who picked Dark on a light system still got light pages in the browser tab and light native chrome.
Playwright emulates `prefers-color-scheme: light` unless told otherwise, so every screenshot from `tests/e2e/harness.ts` and the `test-malini-app` launcher came out light.
The bridge strips every `MALINI_*` variable from the agent's environment (`claudeEnvironment`), so nothing told an agent which theme to capture an app in.

## Decision

- The renderer sends the theme mode, `system`, `light` or `dark`, with `app.theme-mode` at boot and on every change (`sync-native-theme.command.ts`), and main sets `nativeTheme.themeSource` to it (`ShellHost.followThemeMode`).
  Pages in the browser tab follow it through `prefers-color-scheme`.
- Main sends the effective theme, `nativeTheme.shouldUseDarkColors` as `light` or `dark`, as `theme` on every `send_prompt` (`SendPromptHooks.theme`, wired in `src/main/modules.ts`).
- The bridge adds a `- Theme:` bullet to the `<malini>` instructions telling the agent to capture every screenshot in that theme, and sets `MALINI_THEME` in Claude Code's environment, the one `MALINI_*` variable an agent sees (`packages/agent-bridge/src/claude/instructions.ts`, `session.ts`).
- The theme joins access, mode, report resolution and skills in `canContinue`: a prompt in another theme starts a new Claude Code that resumes the conversation (0038), so the instructions are never stale.
- `launchMalini` in `tests/e2e/harness.ts` and `launch` in `.agents/skills/test-malini-app/scripts/malini.mjs` pass `colorScheme` from `MALINI_THEME`, and `null`, the system's, without it.

## Consequences

- Screenshots from `browser_screenshot`, the e2e harness and the test launcher match what the user sees, with no step for the agent to remember.
- Anything else an agent captures, such as an app window or a simulator, follows only because the instructions ask for it.
- Switching theme costs the next prompt a process start and MCP reconnect.
- E2E screenshots now differ between a light and a dark machine; no test asserts on color (rule 3), so results do not.
- Native menus, dialogs and the window chrome now follow Malini's theme instead of the system's.
- Enforced by `tests/e2e/appearance.spec.ts`, which picks Dark and Light and checks `nativeTheme.themeSource` and the theme the fake bridge received; by the bridge tests in `session.test.ts`, `instructions.test.ts` and `protocol.test.ts`; and by `app.theme-mode` in `src/lib/app/platform/register.test.ts`.
