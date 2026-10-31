# 0137 - Main is merged into a workstream when it reaches its files

Status: accepted

## Context

0096 stopped Malini from updating a workstream from main outside a merge, after Update from main ran 400 times in seven days across 108 workstreams on the user's database, and a friend's import of a repository with many contributors kept their Malini busy merging main.
Since then nothing looked at main before you clicked Merge: on the user's Mac, a workstream with no pull request yet conflicted with main on 11 files, and nothing had noticed.
Malini also fetched main only when it created, updated or merged a workstream, so it could not see a conflict coming.
The user: "Malini should be always addressing conflicts. It doesn't have to always update the main just because", and "I'm curious if we could get smarter about this design."
A conflict can only be resolved by merging main in, so the question is when main is worth merging: when it conflicts with the branch or changed a file the branch changed too, and never only because main moved.

## Decision

- **Malini fetches main and compares.**
  `BaseOverlapWatch` (`src/lib/shared/repositories/platform/base-overlap.service.ts`) fetches the base branch of every repository with an active workstream every five minutes (`BASE_FETCH_EVERY_MS`, or `MALINI_BASE_FETCH_MS` in an unpackaged build), and compares each workstream with `origin/<base>` after each fetch and each Head moved.
  `baseOverlap` (`src/main/git/base-overlap.ts`) reads the merge base, the files each side changed (`git diff --name-only --no-renames`) and the files a merge would stop on (`git merge-tree --write-tree --name-only`), without touching the checkout.
  Lockfiles, changelogs and files `.gitattributes` marks `linguist-generated` count only when they conflict, since they change with almost every commit.
- **Only a safe moment counts.**
  It compares only an active workstream of a repository, never a lead, whose pull request has not merged, with nothing uncommitted, no merge, rebase, cherry-pick or revert in progress, no agent working (`chat.workstream-has-working-run`), so an update never races the commit Malini makes after a turn, and no merge queued or waiting for you (`pull-requests.ship-states`), since a merge updates its own branch and, on GitHub, the merged pull request reads as merged only seconds after main moves: a native run compared a workstream in that gap, merged its own squash commit back in, and the queue opened a second pull request for it.
  A workstream it skips is compared again on its next commit or fetch.
- **Base overlapped.**
  When main has commits the workstream lacks that conflict with it or change a file it changed, it emits `repositories:workstream-base-overlapped` with `head`, `baseHead`, `behind`, `conflicts`, `conflictedPaths` and `overlappingPaths`, once per pair of `head` and `baseHead`.
  Main changing only other files emits nothing.
  The Explorer shows it as **Base overlapped**, from git.
- **Update from main runs on it.**
  The built-in Update from main has the trigger `on repositories:workstream-base-overlapped`, On its own (`BUILTIN_JOBS`, set on existing installs by migration 82, restored by Reset).
  Its page lets you pick another When, such as **Main conflicts with a workstream** (`where conflicts is true`), make it ask, or turn it off.
  It takes no Then (`takesThen` in `src/lib/jobs/domain/builtin-jobs.ts`), since Resolve conflicts takes the conflicts its merge stops on through its own trigger.
  The job runner already holds a run until no agent works in the workstream, and folds a second trigger into a run still waiting.
- **A pull request gets a resolved conflict, and a clean merge stays local.**
  The Shipping rule commits the merge **Resolve conflicts** resolved and pushes it to the workstream's pull request, as it does after every shipping job, since GitHub runs no checks on a pull request while it conflicts.
  A clean merge from a triggered Update from main is never pushed on its own: the Shipping rule settles nothing on that run (`settleOtherJob` in `src/lib/pull-requests/platform/ship-rule.ts`), and the workstream's next push, after its next turn or on Merge, carries it.
  The user agreed to "update locally at the next safe moment, no push", since a local update costs no CI run.
- **Fetches take turns.**
  `syncRemoteBase` (`src/main/git/remote.ts`) runs one fetch at a time per repository, keyed by its common git directory, because fetches into the shared refs at the same time failed with "cannot lock ref 'refs/remotes/origin/main'", and a fetch every five minutes would have made a merge's own fetch lose that race.
- **Offline is quiet.**
  A fetch GitHub does not answer logs nothing; any other fetch failure logs once per repository and base branch until one succeeds, as a warning.

## Consequences

- A workstream stays mergeable while you work: a conflict with main is merged and resolved within five minutes of reaching `origin`, or right after the commit that causes it, before you click Draft or Merge.
- The cost grows with how often main touches the files a workstream changed, not with how often main moves, so in a busy repository most workstreams wait for their merge as they did under 0096.
- An update stops the background commands the workstream's agents left running (0134), and a workstream with a pull request gets a push only once a conflict is resolved, so a clean merge costs no CI run until the workstream pushes its own work.
- Malini fetches each repository with an active workstream every five minutes, with the credentials it already uses; it reaches no new host.
- A file both sides changed is a proxy for a semantic conflict: a change in a file the branch only reads still waits for the merge.
- The pairs it compared live in memory, so after a restart a workstream whose overlap was never merged, such as with the trigger off, emits it once more.
- This supersedes 0096: its setting, update requests and adopted Thens stay removed, Workstream opened still starts nothing in shipping, and a queued merge still updates its own branch.
  It changes 0106's "Update from main stops on conflicts and starts nothing" only in that a trigger now starts it.
- Enforced by `src/main/git/base-overlap.test.ts` (conflicts, clean overlaps, other files, lockfiles, changelogs and generated files), `src/lib/shared/repositories/platform/base-overlap.service.test.ts` (once per pair, only after a fetch, waiting for idle and committed work, skipping work while it merges and once it merged), `src/main/git/remote.test.ts` (eight callers fetch one repository at once), `src/main/diagnostics/platform-log.test.ts`, `src/main/db/migrations.test.ts` (the trigger on existing installs, keeping one you set), `src/lib/jobs/platform/register.test.ts` (the default trigger, no Then), `tests/e2e/update-from-main.spec.ts` (a draft that main starts to conflict with is merged, resolved and pushed without waking its chat; main changing other files starts nothing, and main changing a file a draft changed merges without an agent and stays local until the draft's next turn pushes it; main reaching the files of a workstream while it merges leaves it to its merge, which lands it without a second pull request; with Update from main off, a conflicting workstream waits for its merge) and `tests/e2e/jobs-page.spec.ts`.
