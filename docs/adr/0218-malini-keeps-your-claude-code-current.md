# 0218 - Malini keeps your Claude Code current

Status: accepted

## Context

The Claude models in the picker are the ones the installed `claude` lists, read through the SDK's `initializationResult()` in `packages/agent-bridge/src/claude/capabilities.ts`.
A Mac with Claude Code 2.1.293 and `"autoUpdates": false` in `~/.claude.json` did not list a model released since, while npm offered 2.1.321, and nothing in Malini checked the version it showed in Settings.
The user asked for a system that works for every user, silently, "without worrying if auto updates are enabled or not".
The native install keeps each version as its own file under `~/.local/share/claude/versions/` and only moves the `~/.local/bin/claude` link, so an update leaves a running Claude Code alone.
`claude update` checks for a release and installs it, and it makes the network call itself.
People open the model picker when they look for a new model, so the user asked for the check to happen there too, rather than a button or a Malini release per Claude Code release.
Bundling Claude Code was turned down: its license gives no right to redistribute the binary, and every other agent would need bundling too.

## Decision

- `ClaudeCodeUpdates` (`src/lib/shared/providers/platform/claude-code-updates.service.ts`) runs `claude update` through `runWithTimeout`, with the environment Malini gives every `claude` it starts, a 10 minute limit and one run at a time.
- `registerModules` starts it once the boot environment is resolved, so the login shell's `PATH` finds `claude`, and `providers.stop` stops it.
  It runs at launch and every 6 hours.
- Opening the model picker calls `providers.update-claude-code`, which runs `checkIfStale()`: it joins a check that runs, skips one that started less than 5 minutes ago, and runs one otherwise.
  It answers whether the `claude` executable changed since the picker last asked, by its inode, size and modified time through the link before and after each run, so an update the launch or 6 hour check installed counts too, and the picker reloads the capabilities when it did, so the new model shows up in the open picker.
- Malini never reads `autoUpdates`, and a failed or missing `claude` changes nothing: the next interval tries again.
- `MALINI_CLAUDE_UPDATES=off` stops it, and `providers.update-claude-code` then answers `false` and runs nothing.
  The main vitest project, the e2e harness, the `test-malini-app` launcher, `packaged-smoke.mjs` and `update-e2e.mjs` set it, so no test or agent run touches the `claude` on the machine.
- `ClaudeSession` adds the `claude` executable to the config snapshot it takes of a chat (`configSnapshot`, which stamps each file with its modified time and size through the link), so a chat's idle Claude Code retires at its next prompt after an update and the next one starts on the new version with `resume`.
  A turn that runs keeps the process it started with.
- The picker still refreshes the capabilities when it opens and they are 30 seconds old, and every refresh starts a fresh `claude`.
- The update call belongs to Claude Code, so the outbound calls of Malini's own stay seven.

## Consequences

- A new Claude model reaches the picker the first time it opens after the Claude Code release, at most 5 minutes after the last check, whatever the user's `autoUpdates`.
- A user who pins a version has to start Malini with `MALINI_CLAUDE_UPDATES=off`, and a bad Claude Code release reaches Malini's users within six hours too.
- An update that fails, such as a package manager install that needs permissions, shows nothing, and the picker stays as it was.
- The pinned SDK is not covered: `@anthropic-ai/claude-agent-sdk` still changes only when someone bumps it.
- Enforced by `claude-code-updates.service.test.ts` (the call, the environment, one run at a time, an update only when `claude` replaced itself and told to the next ask once, a missing or failing `claude`, the 5 minute recheck, the interval and stop), `register.test.ts` (the off switch), `model-picker.spec.ts` ("the picker lists a model that a Claude Code update brings while it is open") and `session.test.ts` ("restarts Claude Code for a prompt sent after claude was updated").
