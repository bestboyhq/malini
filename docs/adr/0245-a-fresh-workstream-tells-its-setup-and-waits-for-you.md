# 0245 - A fresh workstream tells its setup and waits for you

Status: accepted

## Context

A new workstream opened on an empty center and the inspector's gutter (0228), and Simon found it "quite poor experience": "they see the gutter on the right and one huge empty space in the middle."
He asked for the middle to show "that we did some step, then we did some another step, and now it's time for the user", with prompts to pick from, because "people are clearly getting lost in this new work stream situation."
Starters showed only while a workstream was the only one (0242), so the second workstream got nothing.
Setup progress lived in memory, in the gutter's provisioning card, and a finished install cleared its record, so nothing was left to tell once setup ended.
Of three prototypes he picked the timeline, asked for the starters as a list rather than a grid, and asked for one that runs the workstream and opens it in the browser.
On the build he named the four starters, "And I think that's it", and asked about the top bar's **Build something great**: "I don't know why would you still have built something great in top right corner?"

## Decision

- **Setup steps.** `WorkstreamSetupSteps.svelte` in `$shared/repositories/presentation` draws `workstreamSetupSteps` from `domain/workstream-setup-steps.ts`, one row a step on a rail.
  While setup runs, it shows the one phase in progress, with the clone percent, or where it stopped.
  Once setup settles: **Branch made from <base>** with the branch, or **Picked up your branch** for a branch Malini did not name `malini/<id>`; **Starts at** with the head commit's short sha and subject; and the install, running, installed, failed with **Retry**, or skipped for want of a lockfile.
  **Your turn** comes last.
  A workstream another chat started (`startedBy`) ends instead on **Prompt from <that workstream>**, **Sends once setup is done**, and lists no starters: its first prompt is already waiting.
- **The head, not the sync.** `WorktreeStatus` gains `headSubject`, read with the head sha in one `git show -s --format=%H%x00%s HEAD` in `src/main/git/status.ts`.
  There is no "Caught up with main" step: a failed base sync only toasts and nothing records it, so the row would claim what nobody checked.
- **A finished install stays.** `visibleInstallStatus` maps `succeeded` to `installed`, and the record keeps the command it ran, in memory for the session.
  `DependencyInstallBanner` ignores `installed`, and `ChatSurface` hides the banner while the steps show.
- **Ways to start.** `FreshChatSuggestions.svelte` lists four starters under the steps in every workstream with no chats, as one bordered list: **Run it in the browser**, **Find the biggest CI/CD pipeline optimizations**, **Find all implicit state machines** and **Plan a change with me**.
  Each fills the composer through `fillComposerCommand`; **Plan a change with me** also sets the run profile to plan mode, and every other starter sets it back to agent.
  The two finders list what they find, biggest or riskiest first, and change nothing until the user picks one.
  **Take one open issue** is gone: on a repository without open issues it sent the agent looking for nothing.
- **No status with nothing to ship.** `pullRequestTopBar` returns no status for a workstream with no changed files, so the top bar shows nothing where it said **Build something great**, and the empty docked header hides itself.
  The setup steps already say whose turn it is.
- **The gutter waits.** `WorkstreamLayout.svelte` hides the inspector's column in a workstream made in this session, on its `malini/<id>` branch, with no chats, no changed files, no browser tab, no live automation and the drawer closed.
  Made in this session is `provisioningRecordQuery.madeHere`: `WorkstreamProvisioningAggregate.begin` marks the id, and settling keeps the mark.
  A workstream that already existed at launch keeps its gutter, so an empty one never flashes it away while its chats load, and Files and Browser stay one click away in it.
  The column stays mounted, so the top-bar status and the inspector's state keep running, and the split's `auto` column gives it no width.
- This amends 0242's starters and 0228's gutter, which now shows from the first message, or earlier once there is something in it to see.

## Consequences

- A new workstream reads as what Malini did and ends on the user, and each row comes from state Malini already holds.
- After a relaunch, setup and install records are gone, so an untouched workstream shows its branch and head only, with its gutter.
- In a workstream just made, Files and Browser have no gutter row until the first message; a change, a browser tab, an agent's reveal or an automation brings the gutter back.
- `src/lib/shared/repositories/domain/workstream-setup-steps.test.ts` fails when a step's wording or state drifts, `src/main/git/status.test.ts` when `headSubject` stops reading the commit, and `workstream-provisioning.aggregate.svelte.test.ts` when a finished install loses its record or its command, or a settled workstream loses its made-here mark.
- `tests/e2e/first-run.spec.ts` fails when the steps, **Your turn**, the four starters, plan mode on **Plan a change with me**, or the hidden gutter go.
- `pull-request-top-bar.test.ts` and `tests/e2e/pull-request-nothing-to-ship.spec.ts` fail when a workstream with nothing to ship shows a status again.
