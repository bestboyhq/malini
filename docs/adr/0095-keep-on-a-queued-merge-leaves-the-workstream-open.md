# 0095 - Keep on a queued merge leaves the workstream open

Status: accepted

## Context

Shipping archives a workstream the moment its pull request merges, and the renderer moves you to Repositories when you were looking at it.
That is the right default: most merged work is done, and archiving frees its worktree and stops what it left running.
But a merge is not always the end of the work, and the user wanted to keep some workstreams open after they merge, decided per merge, with one click.
The top bar already had a place for a merged workstream that stays: **Merged**, with **Archive** and **Continue**, shown when a pull request merged on GitHub outside the queue.

## Decision

- A queued merge offers **Keep** beside **Cancel** (`pull-request-top-bar.ts`); once clicked, the label reads "Queued to merge and keep" and **Keep** goes away.
- **Keep** is a `keep` Button clicked (`ShipButton` in `$contract/pull-requests`), which sets `keep_workstream` on the `workstream_ship` row; queueing a new merge or cancelling clears it.
- Shipping's last move is `land` (`pull-requests/domain/shipping.ts`): it records the merged pull request and emits `pull-requests:ship-changed` with `merged`, then archives the workstream unless the row says keep.
- `acceptShipChangeCommand` marks the pull request state `merged` at once, so the sidebar badge and a lead's count show it without waiting for the next read of GitHub, and moves you to Repositories only when the workstream was not kept.
- `workstreams_list` reports `merged` for open workstreams too, from `merged_pull_request_number` and `merged_pull_request_url`; `repositories.restart-workstream-on-base` clears them, so a continued workstream stops reporting its old merge.

## Consequences

- Archiving stays the default; a chat or job that runs **Merge** still archives, since only the top bar offers **Keep**.
- A kept workstream holds its worktree, chats and background commands until you archive it.
- `shipping.service.test.ts` fails when a kept merge archives or leaves no merged pull request on the workstream, and its other merges fail when they stop archiving.
- `pull-request-top-bar.test.ts` fails when **Keep** is missing on a queued merge or still offered once kept.
- `tests/e2e/merge-queue.spec.ts` "Keep on a queued merge leaves the workstream open on Merged once it lands" fails when the workstream leaves the sidebar or the page, and checks that **Archive** then files it under **Recently archived** with its pull request.
