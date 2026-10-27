# 0102 - A prompt continues a merged workstream on its base

Status: accepted

## Context

A workstream that stays open after its pull request merged, kept (0095) or merged on GitHub outside the queue, showed **Merged** with **Archive** and **Continue**.
**Continue** moved the branch onto the latest base (`repositories.restart-workstream-on-base`), but only when clicked: a prompt sent without it ran on the merged branch, whose next draft carried the merged commits again.
The user: "continue on a merged workstream should be automatic upon user sending a prompt, not a button."
A prompt is the moment the next piece of work starts, so it is the moment to start it from the base.

## Decision

- **No Continue button.**
  **Merged** offers only **Archive** (`pull-request-top-bar.ts`), and its tooltip says "Your next prompt continues on top of the latest main"; `continue` is no longer a `PullRequestActionKind`.
- **Pull requests says where a merged workstream continues from.**
  `surfaceMergedHead` (`pull-requests/domain/repository-surface.ts`) is the base branch and the merged head of a read surface whose pull request merged, or nothing when a merge, rebase or other operation is in progress.
  `acceptRepositorySurfaceCommand` notes it with `noteMergedHeadCommand` in `$shared/repositories`, which keeps it in `mergedHeadsAggregate`, read through `mergedHeadQuery`.
- **A prompt continues it first.**
  `submitPrompt` (`chat/application/commands/submit-prompt.command.ts`) runs `restartWorkstreamOnBaseCommand` before it dispatches when the workstream has a merged head, with your prompt already in the transcript and **Continuing** in the top bar.
  The command reads the merged head itself, forgets it once the branch moved, and refreshes the open workstream's surface, so the top bar leaves **Merged**.
- **A failed continue keeps your prompt.**
  When the branch could not move, a toast says "Continue failed" with why, the prompt is not sent, and the composer gets it back.

## Consequences

- A prompt you send never starts a turn on a merged branch, so the next draft holds only the new work.
- Offline or without GitHub, a prompt in a merged workstream fails until the base can be fetched and the merged branch deleted; **Archive** still works.
- A job's prompt, a prompt from the chat that started the workstream, and a prompt queued behind a running turn run where the branch is, as before.
- A rebase that stops on conflicts still sends the prompt, so the agent can resolve them; the next prompt does not try again while the rebase is in progress.
- This changes 0095's **Continue** on **Merged**; the rest of 0095 stands.
- Enforced by `pull-request-top-bar.test.ts` (Merged offers only Archive and says where the next prompt continues), `repository-surface.test.ts` (which surfaces have a merged head) and `tests/e2e/merge-queue.spec.ts` "a prompt in a workstream whose pull request merged on GitHub first starts it over on the latest main, and keeps the prompt when it cannot".
