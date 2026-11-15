# 0248 - A workstream follows the base branch origin renamed

Status: accepted

## Context

0247 made each new workstream ask origin for its default branch, and left one gap in its consequences: "Workstreams that already exist keep the base branch they started on, even after origin renames it."
`workstreams.base_branch` was written once, so after a rename every fetch of that workstream's base failed with "couldn't find remote ref refs/heads/<old>".
The overlap watch logged the failure and went quiet, and **Update from main** failed with "Could not start the automation: couldn't find remote ref refs/heads/main".
The user wants Malini to be "error resistant" and to "get out of people's way", so a rename on origin must not strand the workstreams that started before it.

## Decision

- `renamedOnOrigin` (`src/main/git/remote.ts`) runs `git ls-remote --symref origin HEAD refs/heads/<old>` from the base clone.
  It names a new branch only when `<old>` is gone, origin's `HEAD` names another branch, Malini still holds `refs/remotes/origin/<old>`, and that commit is an ancestor of the new branch after a fetch.
- `retargetRenamedBase` (`workstreams.service.ts`) then moves every workstream of that project on `<old>`, archived ones included, to the new name with `retargetWorkstreams`, saves it as the project's default branch, and emits `repositories:changed` once, so the renderer reloads its workstreams.
- `retargetWorkstreams` keeps the name a workstream started on in `workstreams.started_on_base`, set once, since its branch's reflog still reads "Created from refs/remotes/origin/<old>".
  The overlap watch accepts that name as a start from the base, so a workstream with no commits of its own still fast-forwards after the rename, while one started from a tag, a commit or a pull request, whose reflog names a commit or another branch, stays where it started.
- It runs at the two places a base fetch fails: the overlap watch, after a failed fetch that is not a network failure, and `onLiveBase` in `register.ts`, which wraps `repositories.pull-workstream`, `repositories.count-behind-base`, `repositories.restart-workstream-on-base` and `repositories.sync-workstream-base` and runs the command again once on the new name.
- **Update from main** reads the workstream's base again after its count, so its pull and its result line use the new name.

## Consequences

- A default branch renamed on origin, such as `master` to `main`, needs nothing from the user: the next fetch, at most five minutes later, or the next update moves each workstream to it.
- A base deleted with commits the new default branch lacks stays as it is and keeps failing, since moving it would change the workstream's diff.
- A base renamed to a name origin's `HEAD` does not point at, such as `develop` to `dev`, is not followed, since `ls-remote` cannot tell a rename from a delete.
- A force-pushed or squash-merged base fails the ancestor check and stays.
- A pull request opened between the rename and the next fetch still targets the old name.
- Each failed base fetch costs one more `ls-remote`.
- Enforced by two tests in `tests/e2e/workstream-setup.spec.ts`, one for the overlap watch and one for **Update from main** run right after the rename, by `workstreams.test.ts`, which renames origin's branch, counts behind the old name, and checks that a deleted base with its own commits stays, and by `base-overlap.service.test.ts`, which fast-forwards a workstream with no commits of its own to the new name.
