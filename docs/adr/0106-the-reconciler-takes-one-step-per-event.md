# 0106 - The reconciler takes one step per event

Status: accepted

## Context

0086 made shipping hear only logged events, but each event woke a `Shipping` class that read its own state and took up to ten moves in a loop, slept through the idle debounce, and kept who woke it and when a turn ended in memory.
When the user clicked Merge on "Child notification UI check" (pull request #96), that loop merged main into the branch and hit conflicts at 11:09:32.707, started its own Resolve conflicts 147 ms later, and the conflict event it set off had no cause and a chain of its own, while the Merge click had joined a day-old chain.
The reconciler skipped a conflict only when its cause was a merge-queue run, and its check for a running resolver ignored merge-queue and running runs, so its model picked "Tell 'Child notification UI check' about the conflicts", the workstream's own chat got "Malini woke you: work you started moved on", and two agents resolved the same files for 45 seconds until the merge was cancelled.
The user: the reconciler "should just know about every single event", "but it should also be mindful about the single responsibility principle", and "I don't agree that reconcilers should ignore something".
They asked "we already have a job, resolve conflicts. So how it didn't get matched to that", said "Malini is owner of a job" and a workstream is only the context it runs in, and that the Shipping class "is holding some responsibilities of reconciler": "We should have a single decision point and it should be a reconciler", which reads "database, git status, github" and decides, with "no separate shipping class" and everything "going through our event system".
They also corrected the plan: "I don't think a user is marking a pull request ready", they mark the workstream, so the steps Malini takes on GitHub are actions, not events of their own.

## Decision

- **One decision point.**
  `Reconciler.handle` (`src/lib/jobs/platform/reconciler.service.ts`) runs your triggers first, then Malini's own rules, then the model step.
  Shipping is a `ShippingRule` port (`src/lib/jobs/jobs.platform.ts`) that `src/lib/pull-requests/platform/ship-rule.ts` builds: `hear(event)` names the workstreams an event concerns, `decide(workstreamId)` reads fresh state, the `workstream_ship` row, the shipping jobs in that workstream whoever started them, the time its last turn ended, `git status` and the last read of GitHub, and takes one move from `nextShippingMove`, and `merging(workstreamId)` says whether a merge is queued there.
  The reconciler runs one decision at a time per workstream, keeps only the newest event waiting behind it, and carries the move out once; there is no loop, sleep or timer of the rule's own.
  The result comes back as an event and the next decision happens there: Head moved, Branch pushed and Merge conflicted from Malini's own commit, push and pull, which report their git facts at once through `WorkstreamWatchers.refresh`, Pull request changed from a read right after each GitHub step, and Job finished.
  A step that brings no event back sets a `retry` alarm `githubPollMs` out (`heardBack`), and the five seconds after a turn ends is an `idle` alarm, read from `agent_runs`.
- **No Shipping class.**
  `shipping.service.ts` is gone: `ship-intents.ts` records what your clicks ask for, `ship-rule.ts` hears and decides, `ship-moves.ts` takes the one step, and `ship-store.ts` keeps the row helpers.
  0086's clicks as events, GitHub reader, alarms and `workstream_ship` stay.
- **Causes say who acted.**
  `event_log.cause_kind` admits `event` (migration 75, which keeps every event and its id).
  An event emitted while the reconciler handles another names that event as its cause and joins its chain (`withHandledEvent`, an `AsyncLocalStorage` scope that closes when the handling ends, so a timer or watcher armed during it never inherits it).
  A wait the Shipping rule sets keeps that event as `causeEventId`, so its **Time reached** names the event whose decision set it.
  Button clicked and Workstream opened take no cause, so your click starts a chain of its own, and a read of GitHub outside a handling names your last click on that workstream's bar unless work ran there since.
- **A conflict starts Resolve conflicts.**
  The built-in Resolve conflicts has the trigger `on repositories:workstream-merge-conflicted`, On its own (`BUILTIN_JOBS`, set on existing installs by migration 75, restored by Reset), and you can turn it off or make it ask on its page.
  Update from main stops on conflicts and starts nothing; scheduled runs no longer merge main inside the job runner, the Schedules rule runs Update from main first when the workstream is clean and behind, or says why it did not.
  Queued Resolve conflicts runs dispatch first, and a merge waits while any shipping job runs in its workstream, waiting runs included, running Resolve conflicts itself only when none is, within its fix attempts.
- **The reconciler records why it does nothing.**
  When work already owns an event the model step would take, a conflict Resolve conflicts is on or a merge is merging, or a shipping job's failure that Merge or Shipping takes over, it records a decision by rules that picks Do nothing with the reason (`handledSituation`), instead of skipping the event silently.
- **Reports go to who asked.**
  A conflict tells only the chat that asked for the work that merged, found along the cause chain (`requesterSessionId`), never the chat that happens to work in that workstream.
  A wake about a job or a conflict opens "Malini woke you: work you asked for moved on" and leaves out `workstreams_send`, which stays for a workstream the chat started.
- `RULE_EVENTS` adds Branch pushed and Merge conflicted to the events Shipping hears, and `ShippingWait` adds `idle`.

## Consequences

- A merge that stops on conflicts gets one Resolve conflicts, started by its trigger, linked to the Merge conflicted event and in the chain of your click; nothing wakes the chat in that workstream.
- A merge from the click to the merged pull request is one chain, so the Explorer and `event_log` time each step.
- Each step costs one event round trip, and a step GitHub reports late waits for the reader's next read or the retry alarm.
- The shipping decision keeps no state outside the database, and its serialization lives in the reconciler.
- Every event the model step would take now leaves a decision, so the decision log grows by the events work already owned; Activity hides Do nothing, and the Explorer shows it.
- This supersedes 0086, and changes 0085's causes and chains, 0091's order of the rules and the events Shipping hears, 0096's Update from main handing conflicts to Resolve conflicts, and 0103's wake text for a job or a conflict; the rest of each stands.
- Enforced by `src/lib/pull-requests/platform/ship-rule.test.ts` (a merge waits for the Resolve conflicts its trigger starts, in the chain of the click), `src/lib/jobs/platform/reconciler.service.test.ts` (the trigger and no wake, the chat that asked for the work, the recorded Do nothing), `src/lib/jobs/domain/reconciler.test.ts` (`handledSituation`, `wakePrompt`), `src/lib/jobs/platform/event-log.service.test.ts` (event causes, your click's chain), `src/lib/shared/repositories/platform/watcher.test.ts` (`refresh`), `src/lib/jobs/platform/register.test.ts` (Update from main stops and starts nothing), `src/lib/jobs/platform/job-schedules.service.test.ts` (Update from main before a scheduled run), `src/main/db/migrations.test.ts` (migration 75), and `tests/e2e/update-from-main.spec.ts` and `tests/e2e/jobs-page.spec.ts`.
