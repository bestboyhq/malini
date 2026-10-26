# 0083 - Events carry their cause, and a reconciler routes every event

Status: accepted

## Context

The user wants Malini to orchestrate work the way an event-driven system does, "something happens, system is dispatching an event, and then you get a bunch of handlers that are reacting to that event", rather than through one long-running supervisor agent, which means "delegating trust" and being "more prone to model nerfs".
Events lived only in memory (`createEventBus`), so a restart forgot which events had already started a job, and nothing recorded what caused an event: a trigger linked a run to its cause only for `jobs:run-changed`, so a job that edited files could set off its own `files-changed` trigger forever.
Each matching event saved a new run, so a burst of the same event queued the same job again and again.
Git facts were invisible unless Malini acted: `repositories:workstream-merge-conflicted` fired only after Malini's own pull, and the watcher reported commits and pushes as generic file changes.
The merge queue polled GitHub on timers, so the 61 jobs it started in one day of the user's history came from nothing in the log, each in a chain of its own.
A chat that started workstreams never heard back from them; one lead, wanting to send its child a follow-up, found no tool for it and saved a job instead.
The user settled on "rules first, the agent second": a small model that only chooses among options code built, every decision logged so it can be replayed on other models later, "something like a system visualization or like a timeline" to replay the last day, and Haiku first, the way the Name chats job runs.
A first map drew the system as a loop, with GitHub between the work and the event log and a wire back from the listeners to the jobs, and the user found it unclear: "all events should go from left to right always", with GitHub, the user and every other source on the left.
The left-to-right map still showed no reconciler, though the user expected one: "reconciler is the middleman between an event that happened and a handler that got called".
The code had none: the log handed each event to the triggers and only what they missed to the `Reconciler`, and the job runner started Thens itself.
The event names "look vibed", "not following a single framework, and because of that they are somewhat difficult to navigate": a new workstream should read "Workstream created", an archived one "Workstream archived", and a job run "Job started" and "Job finished".
The log could not count those, because it kept `jobs:run-changed` for every status a run passed through and `jobs:agent-action-changed` for both the start and the end of a tool call.
The map then drew the event sources and the event log as two columns, and the user asked why: "it should be a single column naming properly formatted events our system recognizes, with a source label, prob going into reconciler back into new or existing job/workstream/chat".
A source was only a label of its event type, and the column mostly held the starters that skipped the log: in the user's last 24 hours, You, the merge queue and Resume started 236 of 250 chat turns and job runs, and the reconciler none.
The user rejected that anything starts on its own: "everything comes from an event and Malini is just a meta layer combining all of those things"; Resume "starts after Malini boots up", the merge queue "after merge button was clicked", and schedules "from some event carrying time".

## Decision

- **The event log.** `EventBus.observe` (`src/main/events.ts`) sees every emit, and `startEventLog` (`src/lib/jobs/platform/event-log.service.ts`) writes each one to `event_log` (migration 67) unless its catalog entry says `logged: false`: agent stream events, MCP server listings, clone progress, scale changes, browser state, stats samples, decision updates, and the status updates of job runs and tool calls.
  It keeps facts, named for their subject and what happened to it: `JobRunner` emits `jobs:run-started` when a queued run starts and `jobs:run-finished` once when it ends, and `recordAgentAction` emits `jobs:tool-called` once per call, while `jobs:run-changed` and `jobs:agent-action-changed` stay as updates for the window.
  A row keeps the channel, the payload (`null` past 64 KiB), a SHA-256 digest of the canonical payload, the workstream, its cause and its chain; an event whose payload names no workstream takes its cause's.
  The cause is the job run or chat turn working in that workstream, or one that ended there within 5 s, naming a job rather than the turn it ran in; for `jobs:run-started` and `jobs:run-finished` it is the run itself, for chat events the turn, and for a workstream's setup events the work of the chat that started it.
  What the merge queue reports, `pull-requests:pull-request-changed` and `pull-requests:ship-changed`, takes the work last done in that workstream however long ago it ended, since a pull request shows what that work pushed.
- **Chains.** Every `job_runs` and `agent_runs` row has a `chain_id`.
  A run takes its parent run's chain, else its cause event's, else the chain of the chat turn it was asked from; a prompt the user types starts a new chain (`agent_runs_own_chain` trigger).
  `chat.send-prompt` takes `chainId` and `causeEventId`, and the job runner, `workstreams_create`, `workstreams_send` and the reconciler's wakes pass them on.
  The merge queue passes `jobs.run` the read of GitHub that made it start the job.
- **The reconciler routes.** `Reconciler.handle` (`src/lib/jobs/platform/reconciler.service.ts`) is the one middleman between an event and what reacts to it: the log's dispatcher hands it every event, and it hands each to the rules first, then to the model.
  The rules (`ReconcilerRules`) are the triggers (`job-triggers.service.ts`), the Thens (`JobRunner.startThen`), the merge queue (`MergeQueue.handle`), Resume (`ChatPlatform.resume`) and the schedules (`createJobSchedules`); `src/main/modules.ts` hands `registerJobs` the merge queue's and the chat's rule.
  A Then starts from the `jobs:run-finished` of a run that succeeded, with that event as its cause, instead of the runner starting it.
  Each rule settles on its own (`Promise.allSettled`), so a rule that throws is logged and the others and the model still run.
  The model takes what no trigger matched; a Then never stops it, so the chat that ran a job still hears back.
  An event is marked handled once the reconciler is done with it, and the unhandled events of the last hour are handled again at boot.
  An event whose digest already started a job (`job_run_events`) never starts that job again, even after a restart, which keeps a replayed `jobs:run-finished` from starting its Then twice.
  The log keeps 7 days and decisions 30, pruned hourly.
- **Every start is an event.** Nothing starts work on its own; only what you do yourself, a prompt or a click on a job, and what an agent starts with its tools go straight to a chat or a job.
  - `app:started` (**Malini started**) fires once per boot from `AppPlatform.announceStart`, once the event log listens.
    Resume continues the turns a quit paused (`continuePausedRuns`) on the first one it hears, each in the chain of the turn it continues, with the event as its `cause_event_id`, and the merge queue picks its queue up on it; the agent service and `pullRequests.start()` no longer do either at boot.
  - `jobs:time-reached` (**Time reached**) fires from the schedules' clock once per due time, with the job, its schedule and the time it was due.
    The Schedules rule starts the job with the event as its cause, skips a time while the last run is unfinished, and `triggeredBefore` keeps a replayed event from starting it twice.
  - `pull-requests:draft-requested` and `pull-requests:merge-requested` (**Draft requested**, **Merge requested**) fire from `openDraft`, `queueMerge` and `retryMerge`, which no longer wake the queue themselves.
    The merge queue's rule wakes the workstream on them, and on a logged `pull-requests:pull-request-changed` while the queue is not already working there, so a change the top bar reads moves a waiting merge at once.
    Its own polls of GitHub stay the sensor that logs those changes, and its reactions to a read that changes nothing, such as updating from main while the pull request stays behind or answering a new review whose counts match the last one, stay on the read, since such a read logs no event.
    A job the merge queue starts names the latest Pull request changed about its pull request as its cause, else the latest of those requests.
- **Repeat runs fold.** `jobs.run` folds a request into a waiting or queued run of the same job for the same workstream, repository and scope, unless it comes from the merge queue, a schedule or a chat: `requests` counts the asks, the contexts append, and a request made by hand starts a waiting run.
  Activity shows **Asked N times**.
- **A budget per chain.** The fourth run of a job for the same target in one chain waits for the user: "It already ran 3 times in one chain of events, so Malini asks before it runs again." (`JOB_CHAIN_REPEAT_LIMIT`).
  The merge queue's runs neither wait on it nor count toward it, because **Fix attempts before asking you** already bounds them.
  Malini wakes a chat at most 3 times about the same work in one chain (`RECONCILER_WAKE_LIMIT`); past that it asks the user instead.
- **Facts.** The workstream watcher reads `HEAD`, the branch, `origin`'s branch and `MERGE_HEAD` after git moves, and emits `repositories:workstream-head-moved`, `repositories:workstream-pushed` and `repositories:workstream-merge-conflicted` whoever moved it, each conflicted `MERGE_HEAD` once, shared with Malini's own pull (`reportMergeConflict`).
  The chat runtime emits `chat:turn-finished` when a turn of a user's chat ends, with its status and the `Outcome:` and `Needs:` it stated (`FinishedTurns`).
  The merge queue emits `pull-requests:pull-request-changed` when a read of a workstream's pull request, its own or the top bar's, differs from the last one logged there (`pullRequestChange`, `latestLoggedEvent`), and names the latest one about the same pull request as the `causeEventId` of each job it starts.
- **The model.** The reconciler takes the logged events no trigger matched to the model one at a time, keeping only the newest per subject.
  For a turn that ends in a workstream a chat started, a job a chat ran that finishes or fails, and a merge that stops on conflicts nobody in Malini is resolving, code in `src/lib/jobs/domain/reconciler.ts` writes the facts as short lines and the candidates: Do nothing, Wake that chat, Run the job again, Run Resolve conflicts, Ask you.
  The built-in job **Reconcile events** (Haiku, low effort, editable and resettable on the Jobs page, 0011) picks one through the bridge's `choose` command (protocol 41), whose `outputFormat` JSON schema admits only `{ "pick": 1..N }`.
  Code then checks the pick against the wake budget and carries it out; the model never acts and never writes text Malini runs.
- **Wakes and asks.** A wake is a prompt from the started workstream into the chat that started it, held while that chat works and sent with every report waiting for it as one prompt when its turn ends.
  An ask waits under **Waiting for you** in Activity with a button per candidate, counts toward the Jobs badge and notifies; `jobs.decide` carries out the pick once.
- **The decision log.** `reconciler_decisions` keeps each decision's event, facts, candidates, pick, the candidate carried out, who decided (`model`, `rules`, `you`) and its status, and `jobs:decision-changed` reports each change.
  The job's inputs and outputs are recorded like Name chats', so its Improve page replays real decisions on another model or instructions.
  Settings, Jobs, **Reconcile events** (`jobs.reconciler`, on by default) turns it off.
- **Replies and standing.** `workstreams_send` (protocol 41) sends a prompt into the chat of a workstream this chat started, only while that chat is idle, and asks like every write (0053).
  `workstreams_list` returns each workstream's `working`, `outcome` and `needs`, and the agent instructions say that started work reports back and how to answer it.
- **The explorer.** Jobs, **Explorer** (`jobs.list-timeline`) draws the system as one pipeline from left to right: one column of logged events, the **Reconciler** every one enters, and the chats and jobs its rules start, with one wire back from that work to the log, since chats and jobs set off most events.
  Each row is an event type named `<Subject> <past-tense verb>` (`explorer-copy.ts`), with a label for its source, agent, git, GitHub, Malini or clock (`ROW_SOURCES`), instead of a column of source boxes: Turn finished, Tool called, Job started, Job finished, Head moved, Branch pushed, Merge conflicted, Pull request changed, Draft requested, Merge requested, Workstream created, Workstream archived, Malini started, Time reached, and Other; a listed event's title starts with its name, such as "Job finished: Fix checks".
  The Reconciler is a card that holds its rules, each with the events it hears and what it started, then **Reconcile events** with its decisions.
  **You** sits above the log, with a wire straight to the chats and jobs it starts, and an agent's chats and jobs start each other inside the work column.
  The wires are segments that never overlap: one stub per row, a bus and a trunk into the Reconciler, and one fork out of it (`explorer-layout.ts`); a lit chain draws its routes in full on top.
  **Play** sends a dot along each event's route, a selected event lights up its chain, which also lists the cause from another chain that set it off, such as the Malini started behind a resumed turn, and **Every event** shows the events it otherwise leaves out.
  `channelCounts` keeps the event log's counts exact past the 2,000 events the window lists, and chat turns carry `resumed` and an `interrupted` or `cancelled` status, so a restart never reads as a failure.
  The timeline under the map counts its steps, since it holds turns, runs and decisions as well as events.
  The scrubber is hyper-ui's `Playhead`, moved there from the chat's video compare.

## Consequences

- "Why did this run?" has an answer in data: follow the cause and the chain back, in the Explorer or in `event_log`.
  A loop stops itself after three runs, or three wakes, and asks the user instead of running on.
- Every reaction to a logged event enters through `Reconciler.handle`, so a new rule joins there, and the Explorer draws what passes through it.
  A trigger on `jobs:run-changed` still fires, but without a logged event it has no cause event and no replay at boot, so the docs point triggers at `jobs:run-finished`.
- Malini reacts the same way to a commit, a push or a conflict whoever made it, which is what a later decision needs before agents may run more of git themselves (0006 still holds).
- A failing check, a review or a moved main traces back to the work it is about, and the merge queue's jobs sit in that chain instead of each starting one of their own.
  Every read of a pull request costs a lookup of the last one logged, and a pull request whose state flaps, such as a count GitHub fails to return once, logs each flip.
- Every logged event costs a SQLite write on the emit path, and every event the reconciler takes on costs a Haiku call; folding per subject and the switch in Settings bound both.
- The model only picks: a new kind of action needs a new candidate in `src/lib/jobs/domain/reconciler.ts` and its carrying out in the service, never free text from the model.
- Not built yet: the classifier trained on the decision log, a local model (Apple's on-device model or a bundled open one) behind `choose`, a Then on failure, and a wait for a group of runs.
  The merge queue still reacts to a read of GitHub that logs no event: routing that too needs a read event, or a payload that tells a new review from the last one.
- A boot that crashes before it marks its Malini started handled replays it at the next boot within the hour; Resume acts once per process, on the first one it hears, so a paused turn is never continued twice.
- Enforced by `src/lib/jobs/platform/event-log.service.test.ts` (causes, the merge queue's included, chains, replay at boot, a Then started once across a restart, a cause's workstream, pruning), `reconciler.service.test.ts` (wakes, held wakes sent as one prompt, asks, the wake budget, retries, conflicts, the Off switch, the timeline), `register.test.ts` (folding, the chain budget and the merge queue outside it, a run that starts and finishes once), `job-schedules.service.test.ts` (a run started on the Time reached it logs, named as its cause, never twice for one time), `src/lib/jobs/domain/reconciler.test.ts` and `explorer.test.ts` (every start through the Reconciler and its rules, no hop backwards, a chain with the cause that set it off), `src/lib/pull-requests/platform/merge-queue.service.test.ts` (each new read logged once, the job naming it, a queued merge that moves only on its Merge requested, a read that shows checks passed moving a waiting merge) and `src/lib/pull-requests/domain/merge-queue.test.ts` (what a read reports), `src/lib/chat/platform/agent/commands.test.ts` (a paused turn continued once Malini started reaches it, in its chain), `src/lib/chat/platform/runs-events.repository.test.ts` (turn statuses, resumed turns), `src/lib/chat/platform/finished-turns.test.ts`, `src/lib/shared/repositories/platform/watcher.test.ts` (git facts), `src/main/db/migrations.test.ts` (migration 67), the bridge's `protocol.test.ts`, `cli.test.ts` and `choices.test.ts`, and `tests/e2e/event-reconciler.spec.ts` (a turn a restart cut short goes on once Resume hears Malini started), `merge-queue.spec.ts`, `job-runs.spec.ts`, `jobs-page.spec.ts` and `settings.spec.ts`.
