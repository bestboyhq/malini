# 0167 - Malini runs every command in a sandbox of its own

Status: superseded by 0172

## Context

0151 ran a job that does not see everything in Claude Code's sandbox, and Sandboxed chats ran there too, while Auto and Full chats and every workstream install ran as the user, with nothing between a malicious package and `~/.ssh`.
Claude Code's macOS profile denies the `bootstrap_check_in` Chromium needs (`FATAL: bootstrap_check_in com.github.Electron.MachPortRendezvousServer: Permission denied (1100)`), and no setting reopens it, so Electron, Playwright, file watchers and terminals could not start inside it.
From Oct 20 to Nov 6, jobs asked to leave that sandbox 46 times across 23 runs, 30 of them for e2e, and waited 36 hours for an answer; the `ponytail:` on `askBeforeLeavingTheSandbox` could not help, since each shard's command differs.
The user asked "can we always assume that our code is executing within the sandbox?", then "I need something that runs electron", and after the count, "im really tired of that".
A profile Malini writes itself ran the whole unit suite, 3,539 tests including the watcher and pty ones, and the e2e suite in real Electron, 377 passed with one skipped and one flake whose race this change fixes, while the hidden folders, writes outside the checkout, `launchctl`, opening and scripting apps, the clipboard, screenshots and the internet stayed blocked.
This replaces how 0151 enforces a job's boundary, Claude Code's sandbox and `askBeforeLeavingTheSandbox`; what a job sees and reaches, and the rest of 0151, stand, and so does 0010's localhost binding.

## Decision

- `packages/agent-bridge/src/sandbox.ts` writes one deny-default Seatbelt profile, `sandboxProfile({ checkout, hidden, internet })`, shared by the bridge and main through the `@malini/agent-bridge/sandbox` export.
  - It reads everything but credentials (`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.docker`, `~/.netrc`, `~/.config/gcloud`, cookies and the browsers' profiles), what `hidden` names, and every bridge's secrets folder, matched by its `malini-secrets-<pid>-` prefix wherever it sits.
  - It writes the checkout, its gitdir and common dir, `/private/tmp`, `/private/var/folders`, `~/Library/Caches`, `~/.cache`, `~/.npm`, `~/Library/pnpm/store` and the ttys, and never git `hooks/`, `config`, `config.worktree`, `.claude/settings(.local).json` or `.mcp.json`, which run outside the sandbox later.
  - It allows 39 named mach services Electron and the toolchain need, plus Electron's rendezvous prefix, and no `runningboard`, `replayd`, pasteboard or Apple Events, so a command cannot open or script other apps, read the clipboard or capture the screen.
  - Unix sockets reach only the checkout, the temporary folders and `mDNSResponder`, never `/private/tmp/com.apple.launchd.*`, so `ssh-agent` stays out; `~/.docker` hides the Docker socket.
  - Localhost is always reachable; `internet: true` adds `(remote ip "*:*")` and `com.apple.SecurityServer`, the keychain `gh` signs in through.
  - `/bin/ps` and `/usr/bin/top` run `(with no-sandbox)`, since Malini's process readouts need them and they only read.
- Every agent Bash command runs in it, in chats and jobs, at every access level.
  The bridge sets `sandbox: { enabled: false }` for Claude Code and writes the profile to `sandbox.sb` in the session's secrets folder each run; the `CLAUDE_CODE_SHELL_PREFIX` run script wraps each command in `sandbox-exec -f sandbox.sb` with `ELECTRON_DISABLE_SANDBOX=1`, since Chromium's own sandbox cannot nest inside it.
- A job's `AgentBoundary` goes into the profile: its hidden paths, Claude Code's chat records unless it sees every chat, and its internet switch; `boundaryDenials`, `strictMcpConfig` and `CLAUDE_CODE_DISABLE_AUTO_MEMORY` stay as 0151 set them.
  A chat runs with nothing hidden but credentials, and the internet on.
- A command with `dangerouslyDisableSandbox: true` leaves only with a one-time pass.
  The `confineCommands` `PreToolUse` hook (`src/claude/permissions.ts`) asks for it in Sandboxed and Auto, reason "This command asks to run outside Malini's sandbox, where it can read and change anything on your Mac and reach any site.", and lets it through in Full.
  On an allow, the bridge writes `passes/<32 hex>` in the session's secrets folder and prefixes the command with `: malini-outside-<hex>; `; the run script runs it unconfined only when it removes that pass, and a sandboxed command cannot read or write that folder to mint one.
  Sandboxed access allows every other Bash command outright, except in plan mode.
- Malini's instructions tell the agent what the sandbox blocks and to retry with `dangerouslyDisableSandbox: true` only for that.
- A workstream install runs as `sandbox-exec -p <profile>` with the internet on, hiding Malini's app data except `workstreams` and `repositories`, and Claude Code's chat records (`hiddenFromInstalls` in `provisioning.service.ts`).
- `canSandbox()` is darwin with `/usr/bin/sandbox-exec`; elsewhere, as on Linux CI, commands and installs run unconfined, as Malini ships only for macOS.
  macOS refuses a second, different profile inside a sandbox (`sandbox_apply: Operation not permitted`), so a Malini that runs inside one, as e2e does under an agent, leaves its commands and installs to that outer sandbox: `canSandbox()` is false when an allow-all probe profile fails with exactly that error, and any other failure keeps the sandbox on.
- The `test-malini-app` skill's `shot` captures Malini's window with Electron's `capturePage()`, which needs no screen recording permission and works inside the sandbox; `screencapture` needs `replayd`, which stays blocked.
- The e2e harness keeps the clipboard in memory and fakes the microphone, so tests never touch the user's clipboard and the sandbox needs neither service.

## Consequences

- A malicious package, in an install or in any command an agent runs, gets the checkout and the caches, not the user's credentials, other chats' secrets, LaunchAgents or git hooks.
- Jobs run e2e, vitest and Electron without asking, so the 46 asks are gone; what still asks is what the sandbox blocks on purpose.
- Sandboxed chats reach any site now, where Claude Code's sandbox let them reach only GitHub; the access levels now differ in what asks, not in where commands run.
- With the internet on, a command can reach the keychain, as it could before; Electron's own sandbox is off inside ours; the writable caches can carry a poisoned entry to a command the user runs later; git hooks the repository itself configures, such as husky's, still run when Malini commits.
- Every command that leaves asks again, even one allowed before; the `ponytail:` on `confineCommands` names the upgrade, remembering an allow per command.
- `sandbox-exec` is deprecated; Claude Code and Chromium still use it, so it breaks for everyone at once if it goes.
- A new mach service, socket or path a workload needs is a line in `sandbox.ts`, found with `log stream --predicate 'sender == "Sandbox"'` while the workload runs.
- Enforced by `packages/agent-bridge/src/sandbox.test.ts` (no writes to home, git hooks, git config, Claude Code's settings or `.mcp.json`, no bridge secrets, no internet when off, no second sandbox inside one), `src/claude/secrets.test.ts` (the run script confines every command, a pass lets one out once, a forged marker stays in), `src/claude/permissions.test.ts` (`confineCommands` per access level), `src/claude/session.test.ts` (the profile follows the boundary each run, an allowed exit carries a pass, Claude Code's sandbox stays off), and `provisioning-real-cli.test.ts` (a sandboxed install writes the checkout and cannot read what Malini hides), each on macOS only.
  Nothing in CI runs the e2e suite inside the profile, since CI runs Linux.
