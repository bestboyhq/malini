# 0083 - Events carry their cause, and a reconciler handles what no trigger does

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

## Decision

- **The event log.** `EventBus.observe` (`src/main/events.ts`) sees every emit, and `startEventLog` (`src/lib/jobs/platform/event-log.service.ts`) writes each one to `event_log` (migration 67) unless its catalog entry says `logged: false`: agent stream events, MCP server listings, clone progress, scale changes, browser state, stats samples and decision updates.
  A row keeps the channel, the payload (`null` past 64 KiB), a SHA-256 digest of the canonical payload, the workstream, its cause and its chain.
  The cause is the job run or chat turn working in that workstream, or one that ended there within 5 s, naming a job rather than the turn it ran in; for `jobs:run-changed` it is the run itself, for chat events the turn, and for a workstream's setup events the work of the chat that started it.
  What the merge queue reports, `pull-requests:pull-request-changed` and `pull-requests:ship-changed`, takes the work last done in that workstream however long ago it ended, since a pull request shows what that work pushed.
- **Chains.** Every `job_runs` and `agent_runs` row has a `chain_id`.
  A run takes its parent run's chain, else its cause event's, else the chain of the chat turn it was asked from; a prompt the user types starts a new chain (`agent_runs_own_chain` trigger).
  `chat.send-prompt` takes `chainId` and `causeEventId`, and the job runner, `workstreams_create`, `workstreams_send` and the reconciler's wakes pass them on.
  The merge queue passes `jobs.run` the read of GitHub that made it start the job.
- **Handling.** Triggers and the reconciler read events from the log's dispatcher instead of subscribing themselves.
  An event is marked handled once both are done with it, and the unhandled events of the last hour are handled again at boot.
  An event whose digest already started a job (`job_run_events`) never starts that job again, even after a restart.
  The log keeps 7 days and decisions 30, pruned hourly.
- **Repeat runs fold.** `jobs.run` folds a request into a waiting or queued run of the same job for the same workstream, repository and scope, unless it comes from the merge queue, a schedule or a chat: `requests` counts the asks, the contexts append, and a request made by hand starts a waiting run.
  Activity shows **Asked N times**.
- **A budget per chain.** The fourth run of a job for the same target in one chain waits for the user: "It already ran 3 times in one chain of events, so Malini asks before it runs again." (`JOB_CHAIN_REPEAT_LIMIT`).
  The merge queue's runs neither wait on it nor count toward it, because **Fix attempts before asking you** already bounds them.
  Malini wakes a chat at most 3 times about the same work in one chain (`RECONCILER_WAKE_LIMIT`); past that it asks the user instead.
- **Facts.** The workstream watcher reads `HEAD`, the branch, `origin`'s branch and `MERGE_HEAD` after git moves, and emits `repositories:workstream-head-moved`, `repositories:workstream-pushed` and `repositories:workstream-merge-conflicted` whoever moved it, each conflicted `MERGE_HEAD` once, shared with Malini's own pull (`reportMergeConflict`).
  The chat runtime emits `chat:turn-finished` when a turn of a user's chat ends, with its status and the `Outcome:` and `Needs:` it stated (`FinishedTurns`).
  The merge queue emits `pull-requests:pull-request-changed` when a read of a workstream's pull request, its own or the top bar's, differs from the last one logged there (`pullRequestChange`, `latestLoggedEvent`), and names the latest one about the same pull request as the `causeEventId` of each job it starts.
- **The reconciler.** `Reconciler` (`src/lib/jobs/platform/reconciler.service.ts`) takes logged events no trigger matched, one at a time, keeping only the newest per subject.
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
- **The explorer.** Jobs, **Explorer** (`jobs.list-timeline`) draws the system from left to right, the way events flow: their sources (You, Agents, Git, GitHub, Malini and the Clock), the event log by kind, the listeners, and the chats and jobs they start, with a timeline of events under it.
  Every wire points right: an event leaves its source once, and what an agent does enters again as an event from **Agents** instead of on a wire back from its work.
  **Play** sends a dot along each event's route, a selected event lights up its chain, and **Every event** shows the events it otherwise leaves out.
  A merge queue run comes from its read in the **Pull request** row; one without a read comes from GitHub under the event log, as a resumed turn comes from Malini and a scheduled run from the Clock.
  `channelCounts` keeps the event log's counts exact past the 2,000 events the window lists, and chat turns carry `resumed` and an `interrupted` or `cancelled` status, so a restart never reads as a failure.
  The scrubber is hyper-ui's `Playhead`, moved there from the chat's video compare.

## Consequences

- "Why did this run?" has an answer in data: follow the cause and the chain back, in the Explorer or in `event_log`.
  A loop stops itself after three runs, or three wakes, and asks the user instead of running on.
- Malini reacts the same way to a commit, a push or a conflict whoever made it, which is what a later decision needs before agents may run more of git themselves (0006 still holds).
- A failing check, a review or a moved main traces back to the work it is about, and the merge queue's jobs sit in that chain instead of each starting one of their own.
  Every read of a pull request costs a lookup of the last one logged, and a pull request whose state flaps, such as a count GitHub fails to return once, logs each flip.
- Every logged event costs a SQLite write on the emit path, and every event the reconciler takes on costs a Haiku call; folding per subject and the switch in Settings bound both.
- The model only picks: a new kind of action needs a new candidate in `src/lib/jobs/domain/reconciler.ts` and its carrying out in the service, never free text from the model.
- Not built yet: the classifier trained on the decision log, a local model (Apple's on-device model or a bundled open one) behind `choose`, a Then on failure, and a wait for a group of runs.
- Enforced by `src/lib/jobs/platform/event-log.service.test.ts` (causes, the merge queue's included, chains, replay at boot, pruning), `reconciler.service.test.ts` (wakes, held wakes sent as one prompt, asks, the wake budget, retries, conflicts, the Off switch, the timeline), `register.test.ts` (folding, the chain budget and the merge queue outside it), `src/lib/jobs/domain/reconciler.test.ts` and `explorer.test.ts`, `src/lib/pull-requests/platform/merge-queue.service.test.ts` (each new read logged once, the job naming it) and `src/lib/pull-requests/domain/merge-queue.test.ts` (what a read reports), `src/lib/chat/platform/runs-events.repository.test.ts` (turn statuses, resumed turns), `src/lib/chat/platform/finished-turns.test.ts`, `src/lib/shared/repositories/platform/watcher.test.ts` (git facts), `src/main/db/migrations.test.ts` (migration 67), the bridge's `protocol.test.ts`, `cli.test.ts` and `choices.test.ts`, and `tests/e2e/event-reconciler.spec.ts`, `merge-queue.spec.ts`, `job-runs.spec.ts`, `jobs-page.spec.ts` and `settings.spec.ts`.
