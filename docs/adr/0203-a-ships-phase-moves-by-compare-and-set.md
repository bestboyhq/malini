# 0203 - A ship's phase moves by compare-and-set

Status: accepted

## Context

0086 keeps a workstream's shipping state in one `workstream_ship` row and settles its requests by compare-and-set, and 0106 makes Shipping a reconciler rule that reads that row fresh and takes one step per event, but neither says how the row's `phase` (`local`, `draft`, `queued` or `needs-you`) moves.
On main any patch could set `phase`, and `openDraft` and `queueMerge` in `ship-intents.ts` read the row, awaited GitHub in `refuseNothingToShip`, then wrote the phase without checking that the ship was still where they had read it.
A Draft click still waiting on GitHub could write `draft` over the `queued` that a later Merge click had written, and the merge you queued vanished without a word.
The state machine audit found "about 10 writers, no transition table; `openDraft` writes out of order; some guards drop out silently", and "`recheck` does not arm its alarm".
The second is real: after a restart a `needs-you` ship whose pull request GitHub still showed behind the push got a `null` decision, which runs no step and sets no alarm, so the stopped merge waited for a click although 0023 says a queue on **Needs you** re-checks itself.
This record adds to 0086 and 0106; the rest of 0086 and 0106 stands.

## Decision

- **The allowed moves are a table in the domain.**
  `SHIP_PHASE_MOVES` in `src/lib/pull-requests/domain/shipping.ts` lists the phases each phase may go to, and `shipPhaseMoves(from, to)` reads it.
  A ship may stay in its phase or go to any other, except that only a `queued` or `needs-you` ship goes to `needs-you`, since a ship that never queued has no merge to stop.
- **One function writes `phase`, and its caller names both ends.**
  `updateShip` in `src/lib/pull-requests/platform/ship.repository.ts` takes a `ShipPhase`, the phase the ship must still be in, or a `ShipPhaseMove` (`{ from, to }`) as its last argument.
  It throws a `DbInvariantError` through `invariant` for a move the table does not list, writes `phase` only through `to`, and adds `AND phase = ?` with `from` to its `UPDATE`.
  A writer whose ship already moved on changes nothing and gets `null`.
  `ShipPatch` has no `phase`, so `pnpm check` refuses a patch that sets one, and `insertShip(db, workstreamId)` always inserts a `local` row that then moves through the table.
- **Every writer says which phase it expects.**
  `openDraft` moves from the phase it read before it awaited GitHub to `draft`, and requests the push only when that move won.
  `queueMerge` reads the row again after its await and moves from the phase it finds to `queued`, so a Merge click wins whichever click lands first.
  `retry` moves `needs-you` to `queued`, `cancel` and `cancelDraft` move to `local`, or to `draft` when a pull request exists (`cancelledPhase`), and `recheck`, the stop in `apply` and `shipFailed` move between `queued` and `needs-you`.
  `keepWorkstream` and `retryNow` change no phase and pass the one they read.
- **A click that loses returns the state that won.**
  `upsert` in `src/lib/pull-requests/platform/ship-intents.ts` returns the row as it stands when `updateShip` gives `null` and the row exists, and throws `ShipError('unknown-workstream')` only when the row is gone.
  A click that lost still logs `Button clicked` with the winning state, and `saveShip` in `src/lib/pull-requests/platform/ship-store.ts` returns `null` and emits nothing for a lost write.
- **An unreadable recheck asks again.**
  `decideFromState` in `src/lib/pull-requests/platform/ship-rule.ts` rechecks a `needs-you` ship by reading its pull request first.
  `PullRequestReader.read` answers `read: false` while GitHub's pull request does not contain the local head (`pullRequestChange` gives `null`) and when the read was forgotten while it ran.
  The decision for that answer is now `read-pull-request`: it sets a `retry` alarm `githubPollMs` out through `setShipAlarm`, as 0106 does for a step that brings no event back, and `decision()` re-arms `reader.watch`.
  It used to return `null`.
- **A recheck keeps the failure count.**
  `recheck` in `src/lib/pull-requests/platform/ship-moves.ts` moves `needs-you` to `queued` with `failures: row.failures` after `NO_SHIP_FAILURE` cleared it.
  A ship that fails again on `github-reconnect` now backs off by `shipBackoffMs`, 30 seconds doubling to 10 minutes, where the recheck used to zero the count and `shipFailed` counted from 1 on every lap.

## Consequences

- A Merge click is never undone by a Draft click that was still waiting on GitHub, a Draft click that lost requests no push, and both click orders end `queued`.
- A move the table does not list throws at the write instead of leaving a phase that no reader expects.
- The compare-and-set covers `phase` only: a write that passes no phase, such as `saveShip(deps, workstreamId, { step })`, still lands on whatever phase the row has.
- `updateShip` gives `null` for a stale phase and for a missing row alike, so `upsert` reads the row to tell them apart.
- A stopped merge whose pull request GitHub shows behind the local branch asks GitHub again every `githubPollMs`, 15 seconds, with no backoff.
  The recheck reads GitHub before `nextShippingMove` can choose a push, so a stopped merge that holds commits GitHub's pull request lacks keeps asking until they are pushed; this is open.
- What must stay true: only the `phase` argument of `updateShip` changes `phase`, every caller names the phase it read, and a decision that cannot read GitHub leaves an alarm.
- Enforced by `src/lib/pull-requests/platform/ship-rule.test.ts` on real SQLite and a fake `gh`: "keeps a merge you queued while an earlier Draft click still asked GitHub", "queues a merge it asked GitHub about while a Draft click opened the draft", "refuses to move a ship that never queued straight to needs you", "checks a stopped merge again after a restart found GitHub behind the push" and "backs off longer each time a push whose sign-in git rejects fails again".
  No test calls `shipPhaseMoves` alone or checks the `null` that `updateShip` gives for a stale phase; the two race tests reach both through `openDraft` and `queueMerge`.
