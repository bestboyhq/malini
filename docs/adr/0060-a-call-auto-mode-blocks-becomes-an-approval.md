# 0060 - A call auto mode blocks becomes an approval

Status: accepted

## Context

In auto mode, Claude Code's classifier denies a call outright: the agent gets the denial as a failed tool result, and the chat showed it as a red error box.
The denial ends with "the user can add a permission rule for Bash to their settings", but nothing in Malini could add one, so the user saw a failure they could not act on.
The Agent SDK fires a `PermissionDenied` hook after a classifier denial, before the tool result reaches the model, and the hook may answer `retry: true`, which tells the model it may try the call again.
Probes on Claude Code 2.1.293 showed what gets a retried call through: a `PreToolUse` hook that answers `allow` lets an MCP call past the classifier, and so does an allow rule applied live with `applyFlagSettings`.
Neither gets past a protected write such as `.claude/settings.local.json`, which the classifier blocks again.
A rule written to `~/.claude/settings.json` reaches a running Claude Code only once it restarts.
Even after `retry: true`, the model in a Malini chat sometimes stopped and asked the user, because nothing told it the retry meant the user had approved the call.

## Decision

- The bridge registers a `PermissionDenied` hook (`packages/agent-bridge/src/claude/session.ts`, `#askAboutBlockedCall`) that turns each classifier denial into an `approval.requested` with the reason `Blocked by auto mode: <category>` and an `autoModeRule`, the narrowest rule Claude Code can match the call with (`autoModeRule` in `permissions.ts`): the exact `Bash(command)`, `WebFetch(domain:host)`, a file tool on its absolute path, or the tool's name.
  The hook waits for the user, for up to a day.
- **Allow once** answers `retry: true` and lets exactly that call through once: a `PreToolUse` hook allows the next call with the same tool and input (the same command, for Bash).
  A retried call that auto mode blocks again is not asked about twice.
- **Always allow** sends the decision with `alwaysAllow`.
  Main accepts it only as an allow-once decision on an approval that carries an `autoModeRule`, and stores the decision with scope `once`, since Claude Code, not Malini, keeps the rule.
  The bridge writes the rule into `permissions.allow` of the user's Claude Code settings (`user-settings.ts`, honoring `CLAUDE_CONFIG_DIR` and a symlinked file, and leaving a file it cannot parse alone) before it answers, so a failed write reaches the card as an error.
  It then applies the rule live with `applyFlagSettings` and restamps the settings file in the config snapshot, so the running Claude Code keeps going without a restart.
- **Keep blocked** answers nothing: the denial stands and the run carries on, unlike a denied ask, which stops the run.
- Malini's instructions tell the agent that the hook's retry line means the user approved that exact call.
- The transcript tags the blocked call's `tool.failed` with `autoModeReason`; the chat draws it as a muted `blocked · <category>` row, and an activity group does not count it as a failure.
- The bridge protocol is version 35.

## Consequences

- A blocked call costs the user one click, and the agent finishes the task in the same turn.
- Always allow edits a file outside Malini's data, the user's Claude Code settings, so its write keeps every other key and the user's own file.
- A rule for a whole MCP tool allows every later call of that tool; a Bash rule allows only that exact command.
- A blocked call waits for the user the way an ask does, so an unattended run stops at it until the user answers or the run ends.
- Enforced by the bridge tests in `session.test.ts`, which replay the recorded `autoModeBlock` and `blockedRetry` scenarios, by `user-settings.test.ts` and `permissions.test.ts`, by the main-process test in `commands.test.ts` that refuses `alwaysAllow` elsewhere, and by `tests/e2e/agent-interactions.spec.ts`.
