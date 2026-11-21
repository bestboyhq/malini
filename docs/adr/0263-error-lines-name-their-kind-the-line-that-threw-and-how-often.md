# 0263 - Error lines name their kind, the line that threw and how often

Status: accepted

## Context

0058 sends each failure to Logdash as `<what> failed: <name> <code> (<kind>)`, once per launch, and never its message.
The field log could not be read: `GitError (git)` covered a lost connection, a merge conflict, a refused push and anything git said that Malini did not recognize.
A plain `Error` named nothing at all, and 594 `throw new Error(` sit in main-process code.
States the user or the Mac must fix, such as a GitHub sign-in, a running agent blocking an archive or a full disk, came in as errors beside Malini's own bugs.
With one line per launch and no count, a failure hit once and a failure hit every minute looked the same.
The message stays out: it holds repository names, branches, paths and what a remote said.

## Decision

- `gitFailureVerdict` in `src/main/errors.ts` gives the failures it recognizes their own kind: `network`, `remote-ahead`, `remote-rejected` and `merge-conflict`.
  `git` stays the kind of everything else.
- The commands the field log showed failing with a plain `Error` throw named errors with a kind instead, each keeping its message:
  - `WorkstreamError` in `src/lib/shared/repositories/platform/checkout-resolver.ts`, with kinds such as `unknown`, `not-archived`, `image-path`, `image-unreadable` and `open-failed`, for the checkout resolver, restore, workstream images and the reveal and editor shell.
  - `AgentRuntimeError` in `runtime.ts` for a failed bridge restart and a session that is missing or did not recover, with the `SupervisorError` kind as its code.
  - `McpServerError` in `mcp-servers.ts`, with the bridge's error code as its code.
  - `ClaudeSettingsError` in `claude-settings.ts` for a settings file that is not a JSON object.
  - `FreeSpaceError` in `src/main/fs/free-space.ts`, with code `ENOSPC`.
- Each line names where it was thrown: `<what> failed: <name> <code> (<kind>) at <file>:<line>`.
  `throwSite` in `src/main/diagnostics/throw-site.ts` takes the first stack frame in Malini's own code, past dependencies and the factories in `src/main/errors.ts`.
  It writes the path from Malini's source root, such as `lib/chat/platform/mcp-servers.ts`, never the folder around it.
  The main bundle carries a hidden source map, `out/main/index.js.map`, built without the source text (`sourcemap: 'hidden'` and `sourcemapExcludeSources` in `electron.vite.config.ts`), and `throwSite` reads it with Node's `SourceMap` the first time a line needs a site.
- The first time a line fails in a launch it is sent at once.
  Repeats are counted, and the hourly check and quitting send `<what> · <n> more · <system>` when the count is above zero.
- `commandFailureLevel` in `src/main/diagnostics/main-diagnostics.ts` logs as a warning, and so never sends, what the user or the Mac must fix: the new git kinds with `auth-failed`, `push-denied`, `repository-not-found`, `worktree-busy` and `output-too-large`, `WorkstreamRemovalError` `run-active` and `busy`, `WorkstreamError` `chat-gone`, `repository-gone` and `image-path`, and any failure with code `ENOSPC` or `EDQUOT`.
- `browser.snapshot` stops waiting for a painted frame once its page is destroyed, which was the `TypeError` in the field log.

## Consequences

- A line now says which recognized git failure it was, the file and line that threw, and how often it happened that launch, so the log ranks itself.
- The packaged app is about 1.8 MB larger for the source map.
- A rewrapped error must keep its name and kind or throw the original; a new `new Error(...)` on a command path still logs, by name `Error` and its site.
- Line numbers follow the source of that release, so reading one means opening the tag the line's version names.
- `src/main/diagnostics/throw-site.test.ts` fails when a site leaks the folder around Malini's source or misses the source map.
- `src/lib/app/platform/usage-data.test.ts` fails when a line carries the message, loses its site, or sends a repeat as its own line.
- `src/main/diagnostics/main-diagnostics.test.ts` fails when an expected state logs as an error or a Malini failure logs as a warning.
- `src/main/errors.test.ts` fails when a recognized git failure falls back to `git`.
