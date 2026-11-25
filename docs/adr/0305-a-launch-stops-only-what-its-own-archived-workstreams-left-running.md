# 0305 - A launch stops only what its own archived workstreams left running

Status: accepted

## Context

0082 says that when Malini starts, `registerStats` stops the leftovers of the whole workstreams root, the checkout trash included.
A leftover there is any process whose command line names a folder inside that root and no workstream the database lists as live.
A packaged build without `--user-data-dir` keeps its checkouts in `~/malini` (`checkoutsHome`), so every Malini on one Mac shares that root, each with its own database.
A second Malini, such as the signed `maliniupdatetest` build of `pnpm --filter malini test:update`, knows none of the first one's workstreams, so its launch sent `SIGTERM` to every agent command, test run and dev server that named a path in the user's real workstreams.
The update test died at its last step this way: the relaunched 0.0.3 app stopped the `update-e2e.mjs` run that had started it.
This record replaces that bullet of 0082; the rest of 0082 stands.

## Decision

- When Malini starts, `registerStats` in `lib/stats/platform/register.ts` stops the leftovers of the folders of the workstreams its database marks `archived` (`listArchivedWorkstreams`) and of the checkout trash (`checkoutTrashRoot`), with every workstream not archived as live.
- It never stops a process that names only a folder its database does not know.

## Consequences

- One Malini's launch no longer stops what another Malini, or an agent of it, runs from the shared `~/malini`.
- A process left running from a folder whose workstream row is gone, after a database reset or by an older build, keeps running until the user stops it.
- The trash is shared, so a launch still stops what runs from another Malini's trashed checkouts, which are on their way out.
- Enforced by `tests/e2e/archive-restore.spec.ts`: on relaunch, processes in an archived workstream's folder and in the trash end with `SIGTERM`, and one in a folder the database does not know keeps running.
