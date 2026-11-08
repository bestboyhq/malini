# 0187 - Chromium and agent-browser run inside the sandbox

Status: accepted

## Context

From Nov 7, when 0172 landed, to Nov 8, agents ran 284 commands outside the sandbox, and the user said "im getting those a LOT".
Their transcripts since 0167 name what the sandbox blocked: Playwright's Chromium 32 times in about 15 chats, Docker 12 times in 8, agent-browser 4 times in 3 and wrangler's logs 3 times.
0167 let only Electron register its `MachPortRendezvousServer`, so the headless shell died on `bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.<pid>: Permission denied (1100)` and Chrome for Testing on `com.google.chrome.for.testing`.
agent-browser, which the user's own instructions name for browser automation, stopped at "Socket directory '~/.agent-browser' is not writable", and with that folder open, its Chrome still died on launch until it ran with `--no-sandbox`, since Chrome's own sandbox cannot nest in ours, as Electron's cannot.
wrangler failed to write its logs and dev registry under `~/Library/Preferences/.wrangler`.
Two chats left 11 times to read the macOS log, since `/usr/bin/log` stops with "Cannot run while sandboxed", which also keeps 0167's own advice, `log stream --predicate 'sender == "Sandbox"'`, from running inside.
Once one command in a chat went out, the agent kept leaving for every capture, and the chat asked again after each restart, which `pnpm dogfood` does on every merge.

## Decision

- `packages/agent-bridge/src/sandbox.ts` allows `mach-lookup` and `mach-register` on `(global-name-regex "\.MachPortRendezvousServer\.[0-9]+$")`, every Chromium's rendezvous name, in place of Electron's prefix alone.
- `TOOL_HOMES`, `~/.agent-browser`, `~/Library/Preferences/.wrangler/logs` and `~/Library/Preferences/.wrangler/registry`, are writable, and a command reaches the Unix sockets in them, where agent-browser keeps its daemons.
  wrangler's `config`, which holds its sign-in, stays read-only.
- `SANDBOX_ENVIRONMENT` sets `AGENT_BROWSER_ARGS=--no-sandbox` beside `ELECTRON_DISABLE_SANDBOX=1`, so agent-browser starts its Chrome without the sandbox that cannot nest; a command that passes `--args` itself replaces it.
- `/usr/bin/log` runs `(with no-sandbox)` beside `/bin/ps` and `/usr/bin/top`, since it only reads, and the user's own data in it stays `<private>` unless a profile turns that off.
- Malini's instructions say Playwright with its Chromium and agent-browser run inside, and that a Chrome an agent launches itself needs `--no-sandbox`.
- Docker stays out, as 0167 decided: its socket is in `~/.docker`, and a container can mount any folder Docker shares.

## Consequences

- Playwright's headless shell and Chrome for Testing, agent-browser, wrangler's local commands and `log show` run inside the sandbox without asking, and Electron still does.
- A command reads the unified log of every process on the Mac, as the user can.
- A command can change the Chrome for Testing in `~/.agent-browser/browsers`, which the user's own agent-browser runs later outside the sandbox, as it already could with Playwright's browsers in `~/Library/Caches`.
- A command can drive an agent-browser daemon that runs outside the sandbox, one the user started or a command that was let out, through its socket in `~/.agent-browser`; that browser reads what the user can.
- A command that needs Docker, such as testcontainers, still asks.
- Enforced by `sandbox.test.ts` on macOS (Playwright's headless shell starts in the profile, agent-browser writes its home, `log show` runs) and run outside a sandbox, since macOS refuses a second profile inside one.
