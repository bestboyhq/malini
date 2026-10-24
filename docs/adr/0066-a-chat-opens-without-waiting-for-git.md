# 0066 - A chat opens without waiting for git

Status: accepted

## Context

#7 (`b064775`, "keep images and the tray from moving a chat as it opens") made `sessionActivation.activate` wait for `chat.session-changes` before a chat is shown, so the changed-files bar above the composer cannot appear late and push the transcript up.
`chat.session-changes` composes a chat's net changes with git on every call: one `git diff --raw` per run that changed files, two sparse trees and a numstat in `composeSessionRunSnapshots`.
On the user's own data that took 100 to 335 ms on the first open of a chat since launch, while its transcript loaded in under 10 ms, so the chat sat blank for 300 to 450 ms.
Each open also started that work four or five times at once: the hover, press and focus warm-ups, the activation and the bar's refresh.
The user asked why the chat contents arrive so late, and agreed to show the bar from the database and run git once, after the chat is on screen.

## Decision

- `agent_session_changes` (`session_id`, `runs_digest`, `files`) keeps a chat's composed files, keyed by a SHA-256 digest of its runs that changed files (run id, before and after commit); the row cascades with its session.
- `composedSessionChanges` in `changes.repository.ts` returns that row only while the digest matches the recorded runs, merged with their run ids.
- `chat.known-session-changes` returns what SQLite knows without git: the composed files when they are fresh, otherwise the recorded per-run sums of `sessionChanges`.
- `chat.session-changes` reads the row first and composes only when it is stale, one composition at a time per chat (`composedChanges` in `createCheckpointService`), then writes the row.
- `captureRunFinish` composes the chat's changes in the background right after each capture, so a chat that ran while it was not on screen opens fresh.
- `sessionActivation.activate`, the chat preloader and the hover warm-up call `chatSessionChanges.refreshKnown`, which replaces the renderer's copy, so the bar is in place before the chat shows, as #7 wanted.
- `watchSessionChangesHook` still loads `chat.session-changes` once the chat shows.

## Consequences

- A chat shows as soon as its transcript loads: on the user's data a first open since launch went from 248 to 103 ms, and the blank frames from 200 to 83 ms.
- Git composes a chat's changes once per run that changed files, not on every open.
- A chat whose runs predate this shows the recorded per-run sums on its first open and the composed totals a moment later, once per chat, for example +326 −38 then +292 −4.
- Opening one file's diff (`chat.session-change-patch`) still composes on demand.
- Nothing on the open path may run git for changed files.
  `tests/e2e/transcript-open-motion.spec.ts` enforces it: "a chat reopened after a restart shows its changed files without working them out again" holds every `git diff --raw` with a `git` shim on `PATH`, and the chat must still show its composed totals.
  Every open in that spec also fails when the bar's text changes after the chat shows.
- `service.test.ts` ("a composed chat reads back without git until a run changes its files") fails when the row is not read back, or when a run without file changes makes it stale.
