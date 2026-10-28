# 0105 - Run executes a code block in a terminal Malini owns

Status: accepted

## Context

Since #5 (8895e7f), **Run** on a shell code block sent `Run this:` with the command back to the same chat, so the agent ran it under the chat's access level and the run could be undone.
It waited behind a busy agent, spent a turn on a command the user had already read, and could not run what the agent hands the user because only the user can run it: `gh auth refresh -s workflow` (0103) needs a terminal, and `gh` refuses to prompt without one.
The user: "whenever I click run button on a bash script, it should just execute. It shouldn't tell agents to run it … Malini should spawn some process".
The platform rule allows no native addons, so `node-pty` is out, and Node hands a child a socket for stdin, which macOS `script(1)` refuses as a terminal's input.

## Decision

- **Run spawns the command.**
  `chat.run-shell-command` starts `ShellRuns.start` in `src/lib/chat/platform/shell-runs/service.ts`: the user's `$SHELL -c <command>` in the workstream's checkout, with `buildSpawnEnvironment()` and `TERM=xterm-256color`, never through the agent.
- **A terminal without an addon.**
  `/bin/bash` execs `/usr/bin/script -q /dev/null`, which gives the command a pseudo-terminal sized 100 by 30 with `stty`, and feeds `script` a real pipe through `< <(exec /bin/cat)`, so Node's stdin socket never reaches it.
  `chat.write-shell-input` writes keys to that pipe; `terminalKeySequence` in `src/lib/chat/domain/terminal-text.ts` turns Enter, Backspace, arrows and Control-letters into what a terminal sends.
- **Output as a terminal shows it.**
  `terminalText` drops escape sequences, keeps what a carriage return wrote last and applies echoed backspaces; the service keeps the last 256 KB and emits `chat:shell-run-changed`, unlogged, at most every 100 ms and once when the command ends.
- **Stop is Control-C first.**
  `chat.stop-shell-run` writes Control-C into the terminal, then sends SIGTERM to the process group after 2 s and SIGKILL after 4 s; `stopWorkstreamBackgroundCommands` and `chat.stop()` end what still runs when a workstream is archived or Malini quits.
- **The output runs inside its code block, like a tool call.**
  The user: "they could run in the exact same place where they already are in the chat … not at the bottom, not anywhere else, just inline".
  Each run carries an `anchor`: the message's timeline key and the index of the code block in it.
  `MarkdownText` mounts `ShellRunCard` into that block, under the code: its elapsed time or exit code, the output as it prints, a hidden input that the output focuses on click, **Stop**, and **×**, which runs `chat.dismiss-shell-run`.
  **Run** hides while the block's command runs and runs it again once it ends.
- **One run per code block.**
  `ShellRuns.start` returns the block's run while it still runs, so a second click starts nothing, and replaces a finished one, so the block shows only its latest output.
- **The agent reads what ran.**
  `sendAgentPrompt` appends `<user_shell_commands>` with each command of the chat that it has not reported yet: how it ended and the last 4,000 characters of its output; a finished command is reported once, a running one with every prompt until it ends.
- **A finished run outlives Malini.**
  `ShellRuns` writes a run to the `shell_runs` table when it ends, with whether the agent has read it, and loads them all when Malini starts.
  A unique index on the anchor keeps one row per code block, **×** deletes the row, and deleting the chat deletes its runs.
  Quitting stops a running command first, so it is kept as `stopped`.
- The agent's instructions say its shell code blocks have this button.

## Consequences

- A sign-in, a password prompt or a question runs from the chat, without a terminal window, and the agent answers from the real output.
- What Run does is no longer bound by the chat's access level, and it has no checkpoint to undo: the user clicked a command they can read, as they would paste it into a terminal.
- The terminal never resizes, and full-screen programs such as `vim` do not draw; `node-pty` with xterm.js is the upgrade if those matter.
- The runner depends on macOS `script(1)` and `/bin/bash`; another platform needs its own terminal.
- A code block shows its last output after Malini restarts, and the agent hears about a run it had not read with the next prompt; a command still running when Malini crashes is lost.
- Run again on a block replaces its finished run, so the agent hears only the latest one if the user did not prompt in between.
- Enforced by `src/lib/chat/platform/shell-runs/service.test.ts` (checkout and exit code, a terminal that takes typed answers, Stop, what the agent is told, one run per code block, finished runs and what the agent read across a restart), `src/lib/chat/domain/terminal-text.test.ts`, `src/lib/chat/platform/agent/commands.test.ts` (the prompt block), `packages/agent-bridge/src/claude/instructions.test.ts` and `tests/e2e/shell-run.spec.ts`.
