# 0247 - Run uses node-pty and a headless terminal

Status: accepted

## Context

0105 gave **Run** a terminal without a native addon: `/bin/bash` ran the command under macOS `script(1)`, and `terminalText` guessed what a terminal would show from the escape sequences.
It said what that cost: "The runner depends on macOS `script(1)` and `/bin/bash`; another platform needs its own terminal", and named "`node-pty` with xterm.js" as the upgrade.
Malini now ships for Windows and Linux (0248): Linux's `script(1)` takes other options, and Windows has neither `script(1)` nor a POSIX shell.

## Decision

- **A real pseudo-terminal.**
  `ShellRuns.start` in `src/lib/chat/platform/shell-runs/service.ts` spawns the command with `node-pty`, a ConPTY on Windows, sized 100 by 30 with `TERM=xterm-256color`.
- **A real terminal draws the output.**
  Its output goes into an `@xterm/headless` `Terminal` with 2,500 lines of scrollback, and the run's output is that terminal's buffer as text, so carriage returns, cursor moves and clears show as a terminal shows them.
  `terminalText` is gone, and `terminalKeySequence` still turns keys into what a terminal sends.
- **The code block's language picks the shell.**
  `chat.run-shell-command` carries the block's `language`.
  On macOS and Linux the command runs as the user's shell `-c`, whatever the language.
  On Windows a `powershell`, `pwsh`, `ps1` or `psm1` block runs in `pwsh`, or else Windows PowerShell, and fails when the command fails.
  A `cmd`, `bat` or `batch` block runs in Command Prompt with UTF-8 output, and every other block runs in Git Bash, from `CLAUDE_CODE_GIT_BASH_PATH` or beside `git`.
  Without Git Bash the run fails with "Run needs Git Bash. Install Git for Windows, then run it again."
- **Stop is Control-C, then the process tree.**
  Stop writes Control-C into the terminal, then sends SIGTERM to the process group after 2 s and SIGKILL after 4 s; on Windows it closes the pseudo-terminal instead.
- **Native code, prebuilt.**
  `node-pty` and `@xterm/headless` are the app's runtime `dependencies`, so electron-vite keeps them out of the bundle and electron-builder packs them, with node-pty unpacked from the asar.
  node-pty ships N-API builds for macOS, Linux and Windows on x64 and arm64, so nothing compiles it for Electron (`npmRebuild: false`), and `pnpm-workspace.yaml` lets its install script pick the build.
  The packaged app keeps only the builds for its own OS, without node-pty's sources or Windows debug symbols.
  `.agents/rules/frontend/layers/platform-layer.mdc` allows this one addon.
- The Run resize command, which nothing called, is gone from the contract.

## Consequences

- Run works the same on every OS, and a full-screen program draws into the card as it would in a 100 by 30 terminal.
- The terminal still never resizes.
- A Windows user without Git for Windows can run PowerShell and Command Prompt blocks, but not shell blocks.
- A node-pty upgrade must keep a prebuilt N-API build for all six OS and chip pairs, or a package ships a terminal that cannot start.
- Enforced by `src/lib/chat/platform/shell-runs/service.test.ts` (the checkout and exit code, typed input, output as a terminal draws it, PowerShell and Command Prompt on Windows, Stop), `tests/e2e/shell-run.spec.ts`, and `scripts/packaged-smoke.mjs`, which starts a terminal from the packaged node-pty in the `package` and `release` jobs.
