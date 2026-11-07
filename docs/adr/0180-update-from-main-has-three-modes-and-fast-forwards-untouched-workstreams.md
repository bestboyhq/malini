# 0180 - Update from main has three modes and fast-forwards untouched workstreams

Status: accepted

## Context

0137 merges main into a workstream only when main conflicts with it or changes a file it changed too, and fetches main every five minutes.
The user: "Id love my all workstreams always to do it, but thats because there arent many contributors on repos im working on", and a common change covered in two workstreams should reach the second "right away w/o me even thinking of it".
A workstream with no commits of its own got nothing from 0137, since it touches no file, and merging main into it would only add a merge commit.
0134 stops the dev server an agent left running when a branch updates, so an update that arrives while you look at that server takes it away.
A burst of merges moves main several times in a minute, and 0137 compared after each one.
0178 makes the setup step and Settings rewrite Update from main's trigger, so each mode has to be a When, not a setting.

## Decision

- **Three modes, one trigger.**
  `repositories:workstream-base-overlapped` now fires whenever a workstream is behind main and the comparison reports it, with a new fact, `overlapping`: true when main conflicts with it or changed a file it changed.
  **Touches my files**, the default, is `on repositories:workstream-base-overlapped where overlapping is true`; **Always** drops the condition; **Never** turns the trigger off.
  A migration adds `where overlapping is true` to an install's trigger only while it still reads the old default, so no install moves from 0137's behavior to Always.
  `updateFromMainMode` in `src/lib/app/domain/automation-defaults.ts` reads the mode back from the trigger; any other When reads as Always, and Settings shows it as Custom.
- **Always means this week.**
  `BaseOverlapWatch` (`src/lib/shared/repositories/platform/base-overlap.service.ts`) reports a workstream whose files main did not touch only when it was active in the last seven days (`ACTIVE_WITHIN_MS`), by its latest chat activity or its creation; an older one is reported only when main touches its files, as before.
- **Untouched workstreams fast-forward.**
  A workstream whose branch has no commits of its own, `pristine` from `baseOverlap` in `src/main/git/base-overlap.ts`, fast-forwards to `origin/<base>` in every mode, through the checkout move guard, with no automation, no merge commit and no push.
  It does so only when its branch's reflog says it was created from `origin/<base>`, so a branch you pointed elsewhere by hand stays where it is.
- **A service holds it.**
  The watch skips a workstream while any of its runs is open (`chat.workstream-has-open-run`), which includes a run waiting on a background command such as a dev server (0134), and compares it again on its next commit, fetch or quiet window.
- **Main settles first.**
  After main moves, the watch waits until it has held still for 30 seconds (`BASE_QUIET_MS`, or `MALINI_BASE_QUIET_MS` in an unpackaged build) per workstream before it compares, so a burst of merges starts one update.
- **A landing fetches at once.**
  When this Mac's merge queue lands a pull request (`pull-requests:ship-changed` with `merged`), Malini fetches that repository's base branch and compares its other workstreams right away, instead of within five minutes.
- **It never pushes**, as 0137 decided: the next push of the workstream carries the merge.
- This changes 0137 only in that the event fires for a workstream main did not touch, with `overlapping` false, a pristine workstream fast-forwards, a run with a service holds it, and a merge this Mac lands fetches at once; the rest of 0137 stands.

## Consequences

- One mode moves every workstream you work on with main, which suits repositories with few contributors, and the default still merges only when main reaches your files.
- A workstream you have not touched yet is always current, with no merge commit to explain.
- A dev server keeps running until its run ends; the workstream catches up after.
- An update can arrive up to 30 seconds after main settles, and a workstream idle for over a week waits for its own merge unless main touches its files.
- Enforced by `src/main/git/base-overlap.test.ts` (pristine and overlapping), `src/lib/shared/repositories/platform/base-overlap.service.test.ts` (`overlapping` false only for a workstream active this week, the quiet window, the fast-forward, skipping a busy workstream, fetching on a landing), `src/main/db/migrations.test.ts` (the old default gains its condition, a When you set stays), `src/lib/app/domain/automation-defaults.test.ts` (the three Whens and reading them back) and `tests/e2e/update-from-main.spec.ts` (a workstream with no commits of its own fast-forwards with no merge commit, automation or push; Always merges into a workstream worked in this week once its service stops and leaves one idle for over a week alone).
