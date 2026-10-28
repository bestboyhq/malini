# 0102 - A failing shipping step says why in the chat, and the agent reads it

Status: accepted

## Context

A step Shipping retries after an error showed **Retrying after an error** in the pull request bar, with the reason only in a hover tooltip.
The user: "my friend is super stressed when a pr status is 'retrying after error', cause he cannot see it anywhere", and "can we just show someone when it failed? … could we give some1 a permission to see it?"
The reason was lost before it reached the tooltip: GitHub refuses a push that adds a workflow file when the `gh` sign-in lacks the `workflow` scope, which `gh auth login` does not grant, and git's verdict kept only `failed to push some refs to '…'`, dropping GitHub's `[remote rejected] (refusing to allow an OAuth App to create or update workflow … without workflow scope)`.
The friend's agent could not see the failure either, guessed the cause from the diff, and sent him to push from a terminal.
The user picked the chat note from three mock-ups, and asked that the sidebar turn amber too.

## Decision

- **GitHub's reason survives.**
  `gitFailureVerdict` in `src/main/errors.ts` reads a `! [remote rejected] … (reason)` line as `GitHub refused the push: <reason>.`, and a workflow refusal names the file and the fix: `gh auth refresh -s workflow` for an OAuth App sign-in, the workflow scope for a token, the Workflows permission for a GitHub App.
  `remoteRefusal(error)` keeps what GitHub said: its `remote:` lines, without git progress, and the reason.
- **A failure is on the record.**
  `workstream_ship` gains `github_said` and `failed_since`, and `ShipStateRecord` carries `githubSaid`, `failures` and `failedSince`.
  Shipping's `#failed` records them on every retried failure, and every reset and recovery clears them through one `NO_FAILURE` patch.
- **One note, derived once.**
  `shipFailure()` in `src/lib/pull-requests/domain/ship-failure.ts` turns a draft or queued ship with failures into the note: what failed (`Couldn't open draft`, `Couldn't push`, `Couldn't merge`, …), why, what GitHub said, how many tries, since when and when it tries next.
  Both processes use it.
- **Amber where you look.**
  The pull request bar says what failed, `N tries since HH:MM`, with **Retry now**, and the workstream's sidebar badge is `Needs you · <what failed>`; **Retrying after an error** is gone.
  `ShipFailureNotice` sits in the composer tray of the workstream's chats, beside **The merge stopped on this job**, with the reason, `N tries so far · next at HH:MM · your agent reads this note too`, **Retry now**, **Cancel draft** while a draft opens, and **What GitHub said**.
- **Retry now skips the wait.**
  A `retry` Button clicked on a failing step clears `next_attempt_at` and its alarm, so the Shipping rule tries again at once; a `cancel` on a draft that is opening returns it to `local` and clears its requests and its alarm.
- **The agent reads the note.**
  `sendAgentPrompt` appends `<workstream_shipping>{note}</workstream_shipping>` to the prompt the bridge receives whenever the workstream's ship is failing, through the `shippingFailure` hook `src/main/modules.ts` wires from the pull-requests platform; the transcript keeps the prompt as typed.

## Consequences

- A failure is visible in the bar, the sidebar and the chat, and the agent answers from the same facts instead of guessing.
- This narrows 0101's **No Retry in the bar**: **Retry now** shows only beside a failure whose reason is on screen; a stop still has no Retry in the bar, and the rest of 0101 stands.
- A transient failure, such as being offline, also turns the workstream amber for as long as Malini retries it.
- Enforced by `src/main/errors.test.ts` (remote rejected verdicts and `remoteRefusal`), `src/lib/pull-requests/domain/ship-failure.test.ts`, `src/lib/pull-requests/domain/pull-request-top-bar.test.ts` (the failing status and Retry now, a problem Malini does not retry stays in the tooltip), `src/lib/pull-requests/domain/pull-request-state.test.ts` (the needs-you badge), `src/lib/pull-requests/platform/shipping.service.test.ts` (why, since when and how often, Retry now skips the backoff, Cancel stops the draft), `src/lib/chat/platform/agent/commands.test.ts` (the prompt block), `tests/e2e/ship-failure.spec.ts` and `tests/e2e/push-failure.spec.ts`.
