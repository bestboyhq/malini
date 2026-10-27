# 0093 - A merge leaves its workstream open

Status: accepted

## Context

Since the merge queue, shipping archived a workstream the moment its pull request merged, and the renderer moved you to Repositories when you were looking at it.
ADR 0067 carried that on to workstreams a chat merges: "each workstream merges and archives after its first turn".
The user found the default unnecessary: a merge is not always the end of the work, and archiving tore down the worktree, its chats and what it left running before they chose to.
The top bar already had a place for a workstream whose pull request merged: **Merged**, with **Archive** and **Continue**, shown when a pull request merged on GitHub outside the queue.

## Decision

- Shipping's last move is `land`, not `archive` (`pull-requests/domain/shipping.ts`).
  `ShippingService` records the merged pull request on the workstream, emits `pull-requests:ship-changed` with `merged`, and deletes the ship row; it never calls `repositories.archive-workstream`.
- The `archiving` ship step is gone from `$contract/pull-requests`.
- The workstream stays open on **Merged**: **Archive** puts it away in **Recently archived**, with the pull request it merged, and **Continue** restarts it on the latest base.
- `acceptShipChangeCommand` no longer navigates to Repositories when a merge lands.
- `workstreams_list` reports `merged` for open workstreams too, read from `merged_pull_request_number` and `merged_pull_request_url`; `repositories.restart-workstream-on-base` clears them, so a continued workstream stops reporting its old merge.
- The agent's lineage instructions say merged workstreams carry `merged` instead of coming back archived.

## Consequences

- Merged workstreams stay in the sidebar until you archive them, so their worktrees, chats and background commands live on until then.
- A lead chat counts an open merged workstream as merged through its pull request badge, and an archived one through its recorded merge, as before.
- `shipping.service.test.ts` fails when shipping archives a workstream (its `repositories.archive-workstream` stub throws) or when a landed workstream is not left `active` with its merged pull request recorded.
- `tests/e2e/merge-queue.spec.ts` and the specs that use `expectMerged` fail when a merge leaves the workstream page or drops its row, and `archiveMerged` checks that **Archive** then files it under **Recently archived** with its pull request.
