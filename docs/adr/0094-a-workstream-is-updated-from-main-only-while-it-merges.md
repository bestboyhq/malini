# 0094 - A workstream is updated from main only while it merges

Status: accepted

## Context

0023 had Malini clear "behind main" on its own, and 0086 kept that outside a merge: the Shipping rule ran **Update from main** when you opened a workstream behind its base (**Workstream opened**, at most once a minute) and when a **Pull request changed** showed main moved.
Settings, Jobs, **Update from main** (`merge-queue.update-from-main`) picked between those two and **Only when merging**, and defaulted to updating as main moves.
On the user's database that started Update from main 400 times in seven days across 108 workstreams, every one before a merge was queued: ten in one draft between 23:15 and 11:45, and three on a workstream whose folder was already gone.
The user: "it's running over eagerly", and "It should run only when someone marked a work stream as ready to merge, not before that."
A queued merge already brings its own branch up to date: when GitHub says the pull request is behind or conflicts, the Shipping rule merges the base branch itself (`update-branch`) and hands the conflicts to **Resolve conflicts**.

## Decision

- **Only a merge updates.**
  The Shipping rule (`src/lib/pull-requests/platform/shipping.service.ts`) never asks for an update: a Pull request changed that shows main moved starts nothing, and it no longer hears Workstream opened (`RULE_EVENTS` in `src/lib/jobs/domain/reconciler.ts`).
  `nextShippingMove` (`src/lib/pull-requests/domain/shipping.ts`) has no update move for a local or draft workstream, and its snapshot no `updateRequested` or `behindBase`, so the `read-base` move is gone.
  A queued merge keeps `update-branch` when GitHub reports `behind` or `conflicts`, then Resolve conflicts for what the merge left.
- **No switch.**
  `UPDATE_FROM_MAIN_TRIGGER_SETTING`, `updateFromMainTrigger` and the Settings, Jobs row are gone, and migration 71 deletes a stored `merge-queue.update-from-main`.
- **Workstream opened stays, for your jobs.**
  Opening a workstream still emits `pull-requests:workstream-opened`, through `reportWorkstreamOpenedCommand`, because a job may start on it each time (0093).
- **No update requests.**
  `ShipRequest` is `push` or `review`, and migration 71 drops `workstream_ship.update_requests`.
- **No adopted Thens.**
  Update from main was the only shipping job that started a Then, so `activeThenJobRun` and the Shipping rule's adoption of a child run are gone.
- **Update from main is a job you run.**
  It still merges the base branch without an agent and hands conflicts to Resolve conflicts; the Jobs page says it runs "When you run it".

## Consequences

- A workstream behind main stays on its own commits while you work: no job, no merge commit, no push, until you merge it.
- A pull request GitHub can merge without the branch being current merges without an update, as **Only when merging** did.
- No event payload changes, so the update that ships this runs no Check compatibility for it.
- A database at version 71 has no `update_requests`, so a Malini build from before this decision cannot read shipping state from it.
- This changes 0023's update of a branch outside a merge, 0086's update outside a merge, its Shipping rule hearing Workstream opened and its adopted Thens, 0056's adoption of the Resolve conflicts run Update from main starts, and 0091's count of the events Shipping hears; the rest of each stands.
- Enforced by `src/lib/pull-requests/domain/shipping.test.ts` (a draft behind or conflicting with main only gets pushes), `src/lib/pull-requests/platform/shipping.service.test.ts` (opening a workstream starts nothing, and a draft behind main is updated only while it merges), `src/lib/jobs/platform/reconciler.service.test.ts` (Shipping does not hear Workstream opened), `src/main/db/migrations.test.ts` (migration 71 drops the setting and the column), `tests/e2e/update-from-main.spec.ts` (a workstream behind main stays as it is until you merge it) and `tests/e2e/settings.spec.ts` (no Update from main row).
