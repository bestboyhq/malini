# 0188 - Every Chromium and the macOS log run inside the sandbox

Status: accepted

## Context

From Nov 7, when 0172 landed, to Nov 8, agents ran 284 commands outside the sandbox, and the user said "im getting those a LOT".
Their transcripts since 0167 name what the sandbox blocked: Playwright's Chromium 32 times in about 15 chats, Docker 12 times in 8, agent-browser 4 times in 3 and wrangler's logs 3 times.
0167 let only Electron register its `MachPortRendezvousServer`, so the headless shell died on `bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.<pid>: Permission denied (1100)` and Chrome for Testing on `com.google.chrome.for.testing`.
Two chats left 11 times to read the macOS log, since `/usr/bin/log` stops with "Cannot run while sandboxed", which also keeps 0167's own advice, `log stream --predicate 'sender == "Sandbox"'`, from running inside.
Once one command in a chat went out, the agent kept leaving for every capture, and the chat asked again after each restart, which `pnpm dogfood` does on every merge.
A first fix also opened agent-browser's and wrangler's folders by name; the user answered "I don't want to solve my personal edge cases", so those went to 0189 instead.

## Decision

- `packages/agent-bridge/src/sandbox.ts` allows `mach-lookup` and `mach-register` on `(global-name-regex "\.MachPortRendezvousServer\.[0-9]+$")`, every Chromium's rendezvous name, in place of Electron's prefix alone.
- `/usr/bin/log` runs `(with no-sandbox)` beside `/bin/ps` and `/usr/bin/top`, since it only reads, and the user's own data in it stays `<private>` unless a profile turns that off.
- Malini's instructions say Playwright with its Chromium runs inside, and that a Chrome an agent or a tool launches needs `--no-sandbox`, since Chrome's own sandbox cannot nest in ours, as Electron's cannot.
- The sandbox names no tool's folder; what one tool needs, the user opens through 0189.

## Consequences

- Playwright's headless shell, Chrome for Testing and `log show` run inside the sandbox without asking, and Electron still does.
- A command reads the unified log of every process on the Mac, as the user can.
- agent-browser, wrangler and Docker ask once, and the card offers what the sandbox blocked for them.
- Enforced by `sandbox.test.ts` on macOS (Playwright's headless shell starts in the profile, `log show` runs), run outside a sandbox, since macOS refuses a second profile inside one.
