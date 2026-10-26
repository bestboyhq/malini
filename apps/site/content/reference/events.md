---
title: Events
description: Every event Malini emits, when it fires, and the TypeScript shape of its payload.
---

# Events

Malini announces everything that happens on the platform as an event on a `<domain>:<event>` channel.
A [job](/malini/docs/jobs.md) can start on any of them, and agents inside Malini can list them with the `events_list` tool.
This page is generated from the contract in `apps/malini/src/contract/events.ts`, so it always matches the app.

## `chat:agent-event`

Fires for every event an agent run streams in a chat, such as text, tool calls, approvals and the end of the run, in sequence order. Malini does not keep it in its event log.

Payload: `LiveEventEnvelope`

```ts
interface AgentEventEnvelope {
	sessionId: string;
	runId: string;
	seq: number;
	event: Record<string, unknown>;
}

type LiveEventEnvelope = AgentEventEnvelope & { ephemeral?: true };
```

## `chat:run-changes-captured`

Fires after an agent run that changed files finishes and Malini has recorded the diff of that run.

Payload: `RunChangesCapturedPayload`

```ts
interface RunChangesCapturedPayload {
	sessionId: string;
	runId: string;
}
```

## `chat:checkpoint-restored`

Fires after a workstream's files are restored to a chat checkpoint, rewinding the changes made after it.

Payload: `CheckpointRestoredPayload`

```ts
interface CheckpointRestoredPayload {
	workstreamId: string;
	checkpointId: string;
	sessionId: string;
}
```

## `chat:session-renamed`

Fires when a chat gets a new name, from the user or from the Name chats job.

Payload: `SessionRenamedPayload`

```ts
interface SessionRenamedPayload {
	workstreamId: string;
	sessionId: string;
	name: string;
}
```

## `chat:turn-finished`

Fires when a turn of one of your chats ends, not a job's, with how it ended and the `Outcome:` and `Needs:` lines of its report; `needs` is `null` when the turn needs nothing from you.

Payload: `ChatTurnFinishedPayload`

```ts
type ChatTurnFinishedStatus = 'succeeded' | 'failed' | 'cancelled';

interface ChatTurnFinishedPayload {
	workstreamId: string;
	sessionId: string;
	runId: string;
	status: ChatTurnFinishedStatus;
	outcome: string | null;
	needs: string | null;
}
```

## `chat:mcp-server-changed`

Fires when a sign-in to an MCP server ends, or a retry outside a chat reads its status, with the server and its new status; every open chat reconnects a server that connected.

Payload: `McpServerReport`

```ts
type McpServerReport = Readonly<{
	name: string;
	status: string;
	error?: string;
	source?: string;
	toolCount?: number;
}>;
```

## `chat:mcp-servers-listed`

Fires while the MCP servers page is open, each time the Claude Code that watches a folder sees a server connect, fail, or change, with every server of that folder and whether any is still connecting. Malini does not keep it in its event log.

Payload: `McpServerListing`

```ts
type McpServerReport = Readonly<{
	name: string;
	status: string;
	error?: string;
	source?: string;
	toolCount?: number;
}>;

type McpServerListing = Readonly<{
	workstreamId: string | null;
	servers: readonly McpServerReport[];
	settled: boolean;
	error?: string;
}>;
```

## `repositories:workstream-created`

Fires when a new workstream exists: its git worktree is checked out and it is ready for chats. `workstream.scope` is `home` or `owner:<owner>` for a chat that leads work above repositories, and `workstream.startedBy` is the id of the workstream whose chat started it.

Payload: `WorktreeAddedPayload`

```ts
interface GitProjectRecord {
	id: string;
	name: string;
	repoPath: string;
	defaultBranch: string;
	createdAt: string;
}

interface GitWorkstreamRecord {
	id: string;
	projectId: string;
	name: string;
	path: string;
	branch: string;
	baseBranch: string;
	status: string;
	createdAt: string;
	scope: string | null;
	startedBy: string | null;
}

interface WorktreeAddedPayload {
	workstreamId: string;
	project: GitProjectRecord;
	workstream: GitWorkstreamRecord;
}
```

## `repositories:workstream-removed`

Fires when a workstream leaves the sidebar, with `archived` set when it was archived and `deleted` set when it was deleted.

Payload: `WorktreeRemovedPayload`

```ts
interface WorktreeRemovedPayload {
	workstreamId: string;
	worktreePath: string;
	archived?: true;
	deleted?: true;
}
```

## `repositories:workstream-files-changed`

Fires when files change in a workstream's checkout, with the changed paths, or `null` paths when Malini could not tell which files changed.

Payload: `WorkstreamFilesChangedPayload`

```ts
interface WorkstreamFilesChangedPayload {
	workstreamId: string;
	changedAt: string;
	paths: string[] | null;
}
```

## `repositories:workstream-renamed`

Fires when a workstream gets a new name.

Payload: `WorkstreamRenamedPayload`

```ts
interface WorkstreamRenamedPayload {
	workstreamId: string;
	name: string;
}
```

## `repositories:workstream-install-status`

Fires as a new workstream's dependency install moves through its states: running, succeeded, failed, skipped or aborted.

Payload: `WorkstreamInstallStatusPayload`

```ts
type InstallStatus = 'running' | 'succeeded' | 'failed' | 'skipped' | 'aborted';

type InstallSkipReason = 'already-installed' | 'no-manifest' | 'unrecognized-project';

interface WorkstreamInstallStatusPayload {
	type: 'repositories:workstream-install-status';
	workstreamId: string;
	status: InstallStatus;
	command?: string;
	reason?: InstallSkipReason;
	detail?: string;
	durationMs?: number;
	exitCode?: number;
}
```

## `repositories:workstream-setup-status`

Fires when Malini starts setting up a workstream an agent or a job started, updating its base branch and installing its dependencies, and again with `done` once it finishes.

Payload: `WorkstreamSetupStatusPayload`

```ts
interface WorkstreamSetupStatusPayload {
	workstreamId: string;
	status: 'running' | 'done';
}
```

## `repositories:workstream-merge-conflicted`

Fires when a merge in a workstream stops on conflicts, whoever started it, with the workstream's base branch and the conflicted files.

Payload: `WorkstreamMergeConflictedPayload`

```ts
interface WorkstreamMergeConflictedPayload {
	workstreamId: string;
	baseBranch: string;
	conflictedPaths: string[];
}
```

## `repositories:workstream-head-moved`

Fires when the commit a workstream's checkout points to changes, whoever moved it: a commit, a merge, a pull or a reset, with the branch, or `null` when the checkout is detached, and the commits before and after; `previousHead` is `null` for the first commit of a new branch.

Payload: `WorkstreamHeadMovedPayload`

```ts
interface WorkstreamHeadMovedPayload {
	workstreamId: string;
	branch: string | null;
	head: string;
	previousHead: string | null;
}
```

## `repositories:workstream-pushed`

Fires when a workstream's branch on `origin` moves, after a push or a fetch that brings in someone else's push, with the commit it points to now.

Payload: `WorkstreamPushedPayload`

```ts
interface WorkstreamPushedPayload {
	workstreamId: string;
	branch: string;
	head: string;
}
```

## `repositories:clone-progress`

Fires repeatedly while Malini clones a repository, with the stage and the fraction done, and once more when it is done. Malini does not keep it in its event log.

Payload: `CloneProgressPayload`

```ts
interface CloneProgressPayload {
	repo_id: string;
	stage: 'fetch' | 'checkout' | 'done';
	fraction: number;
}
```

## `repositories:changed`

Fires when a repository is added, cloned, hidden or shown again, so every list of repositories reloads.

Payload: `EmptyEventPayload`

```ts
type EmptyEventPayload = Readonly<Record<string, never>>;
```

## `pull-requests:local-base-synced`

Fires after Malini merges a pull request and tries to bring the repository's local base branch up to date, with the outcome.

Payload: `LocalBaseSyncedPayload`

```ts
interface LocalBaseSyncedPayload {
	workstreamId: string | null;
	checkout: string;
	branch: string;
	outcome: 'advanced' | 'diverged' | 'failed';
	detail?: string;
}
```

## `pull-requests:ship-changed`

Fires whenever a workstream's shipping state changes: its pull request phase, the step Malini is on, or a reason it needs you. A click on the pull request bar's Draft, Merge, Retry or Cancel fires `pull-requests:button-clicked` instead, with the new state.

Payload: `ShipChangedEvent`

```ts
type ShipPhase = 'local' | 'draft' | 'queued' | 'needs-you';

type ShipStep =
	| 'waiting-for-agent'
	| 'opening-draft'
	| 'pushing'
	| 'marking-ready'
	| 'updating-branch'
	| 'updating-from-main'
	| 'resolving-conflicts'
	| 'fixing-checks'
	| 'addressing-review'
	| 'waiting-for-checks'
	| 'waiting-for-review'
	| 'waiting-for-github'
	| 'merging'
	| 'archiving';

type ShipNeedsYouReason =
	| 'reply-to-reviewer'
	| 'fix-gave-up'
	| 'merge-not-permitted'
	| 'pull-request-closed'
	| 'github-reconnect'
	| 'operation-in-progress';

type ShipNeedsYou = Readonly<{
	reason: ShipNeedsYouReason;
	detail: string;
	jobRunId: string | null;
}>;

type ShipStateRecord = Readonly<{
	workstreamId: string;
	phase: ShipPhase;
	step: ShipStep | null;
	pullRequestNumber: number | null;
	pullRequestUrl: string | null;
	needsYou: ShipNeedsYou | null;
	queuedAt: string | null;
	attempts: number;
	activeJobRunId: string | null;
	lastError: string | null;
	nextAttemptAt: string | null;
	updatedAt: string;
}>;

type ShipMerged = Readonly<{ pullRequestNumber: number; pullRequestUrl: string | null }>;

type ShipChangedEvent = Readonly<{
	workstreamId: string;
	state: ShipStateRecord | null;
	merged?: ShipMerged;
}>;
```

## `pull-requests:pull-request-changed`

Fires when Malini reads a workstream's pull request on GitHub and something the Shipping rule decides on changed since the last read it logged: its `state` (`open`, `draft`, `closed` or `merged`), its `checks`, whether any is `checksPending`, the `failingChecks` by name and the `blockingChecks` with when each finished, its `reviewDecision`, the unresolved `threads` and the `changeRequests` of each review with who left it, how many commits it is `behindBase`, its `mergeability`, whether you may merge it and how. Malini reads it every time the pull request bar does, and on its own only while shipping waits on GitHub. Every job the Shipping rule starts for that pull request names the latest one as its cause.

Payload: `PullRequestChangedEvent`

```ts
type PullRequestFailedCheck = Readonly<{
	name: string;
	state: string;
	required: boolean | null;
	appId: number | null;
	completedAt: string | null;
}>;

type PullRequestReviewItem = Readonly<{ id: string; by: string | null; bot: boolean }>;

type PullRequestMergeability = 'ready' | 'conflicts' | 'behind' | 'blocked' | 'unknown';

type PullRequestChangedEvent = Readonly<{
	workstreamId: string;
	pullRequestNumber: number;
	pullRequestUrl: string | null;
	state: 'open' | 'draft' | 'closed' | 'merged';
	baseBranch: string;
	headSha: string | null;
	checks: 'none' | 'success' | 'pending' | 'failed' | 'unknown';
	checksPending: boolean;
	failingChecks: readonly string[];
	blockingChecks: readonly PullRequestFailedCheck[];
	reviewDecision: 'approved' | 'changes_requested' | 'review_required' | null;
	unresolvedThreads: number | null;
	changeRequests: readonly PullRequestReviewItem[] | null;
	threads: readonly PullRequestReviewItem[] | null;
	behindBase: number | null;
	conflicts: boolean;
	mergeability: PullRequestMergeability;
	viewerCanMerge: boolean | null;
	mergeMethod: string | null;
}>;
```

## `pull-requests:button-clicked`

Fires when you click Draft, Merge, Retry or Cancel on a workstream's pull request bar, with the `button` and the workstream's new shipping state; the reconciler's Shipping rule takes the workstream from there.

Payload: `ShipButtonClickedEvent`

```ts
type ShipButton = 'draft' | 'merge' | 'retry' | 'cancel';

type ShipPhase = 'local' | 'draft' | 'queued' | 'needs-you';

type ShipStep =
	| 'waiting-for-agent'
	| 'opening-draft'
	| 'pushing'
	| 'marking-ready'
	| 'updating-branch'
	| 'updating-from-main'
	| 'resolving-conflicts'
	| 'fixing-checks'
	| 'addressing-review'
	| 'waiting-for-checks'
	| 'waiting-for-review'
	| 'waiting-for-github'
	| 'merging'
	| 'archiving';

type ShipNeedsYouReason =
	| 'reply-to-reviewer'
	| 'fix-gave-up'
	| 'merge-not-permitted'
	| 'pull-request-closed'
	| 'github-reconnect'
	| 'operation-in-progress';

type ShipNeedsYou = Readonly<{
	reason: ShipNeedsYouReason;
	detail: string;
	jobRunId: string | null;
}>;

type ShipStateRecord = Readonly<{
	workstreamId: string;
	phase: ShipPhase;
	step: ShipStep | null;
	pullRequestNumber: number | null;
	pullRequestUrl: string | null;
	needsYou: ShipNeedsYou | null;
	queuedAt: string | null;
	attempts: number;
	activeJobRunId: string | null;
	lastError: string | null;
	nextAttemptAt: string | null;
	updatedAt: string;
}>;

type ShipButtonClickedEvent = Readonly<{
	workstreamId: string;
	button: ShipButton;
	state: ShipStateRecord | null;
}>;
```

## `pull-requests:workstream-opened`

Fires when you open a workstream; unless Settings say to update from main only while merging, the Shipping rule runs **Update from main** when the workstream is behind its base branch.

Payload: `WorkstreamOpenedEvent`

```ts
type WorkstreamOpenedEvent = Readonly<{ workstreamId: string }>;
```

## `jobs:run-changed`

Fires whenever a job run waits for you, is queued, starts, needs you, or finishes as succeeded, failed or cancelled. Malini does not keep it in its event log: it keeps `jobs:run-started` and `jobs:run-finished`.

Payload: `JobRunChangedEvent`

```ts
type JobRunOrigin = 'merge-queue' | 'manual' | 'trigger' | 'then' | 'schedule' | 'reconciler';

type JobRunStatus =
	'waiting' | 'queued' | 'running' | 'needs-you' | 'succeeded' | 'failed' | 'cancelled';

type JobRunRecord = Readonly<{
	id: string;
	definitionId: string;
	title: string;
	workstreamId: string | null;
	repositoryId: string | null;
	scope: string | null;
	sessionId: string | null;
	agentRunId: string | null;
	origin: JobRunOrigin;
	status: JobRunStatus;
	detail: string | null;
	parentRunId: string | null;
	chatSessionId: string | null;
	chatAfterRunId: string | null;
	chainId: string;
	requests: number;
	createdAt: string;
	startedAt: string | null;
	finishedAt: string | null;
}>;

type JobRunChangedEvent = Readonly<{ run: JobRunRecord }>;
```

## `jobs:run-started`

Fires when a job run starts working, with the run; a run Malini puts back in the queue fires it again when it starts again.

Payload: `JobRunChangedEvent`

```ts
type JobRunOrigin = 'merge-queue' | 'manual' | 'trigger' | 'then' | 'schedule' | 'reconciler';

type JobRunStatus =
	'waiting' | 'queued' | 'running' | 'needs-you' | 'succeeded' | 'failed' | 'cancelled';

type JobRunRecord = Readonly<{
	id: string;
	definitionId: string;
	title: string;
	workstreamId: string | null;
	repositoryId: string | null;
	scope: string | null;
	sessionId: string | null;
	agentRunId: string | null;
	origin: JobRunOrigin;
	status: JobRunStatus;
	detail: string | null;
	parentRunId: string | null;
	chatSessionId: string | null;
	chatAfterRunId: string | null;
	chainId: string;
	requests: number;
	createdAt: string;
	startedAt: string | null;
	finishedAt: string | null;
}>;

type JobRunChangedEvent = Readonly<{ run: JobRunRecord }>;
```

## `jobs:run-finished`

Fires once when a job run ends, with the run and its `status`: `succeeded`, `failed` or `cancelled`. A job runs after another on it, such as `on jobs:run-finished where run.status is failed`.

Payload: `JobRunChangedEvent`

```ts
type JobRunOrigin = 'merge-queue' | 'manual' | 'trigger' | 'then' | 'schedule' | 'reconciler';

type JobRunStatus =
	'waiting' | 'queued' | 'running' | 'needs-you' | 'succeeded' | 'failed' | 'cancelled';

type JobRunRecord = Readonly<{
	id: string;
	definitionId: string;
	title: string;
	workstreamId: string | null;
	repositoryId: string | null;
	scope: string | null;
	sessionId: string | null;
	agentRunId: string | null;
	origin: JobRunOrigin;
	status: JobRunStatus;
	detail: string | null;
	parentRunId: string | null;
	chatSessionId: string | null;
	chatAfterRunId: string | null;
	chainId: string;
	requests: number;
	createdAt: string;
	startedAt: string | null;
	finishedAt: string | null;
}>;

type JobRunChangedEvent = Readonly<{ run: JobRunRecord }>;
```

## `jobs:definition-changed`

Fires when a job is created, edited, reset to its defaults or deleted; `definition` is `null` after a delete.

Payload: `JobDefinitionChangedEvent`

```ts
type AgentReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

type JobRunsIn = 'workstream' | 'new-workstream';

type JobBuiltin =
	| 'name-chats'
	| 'name-services'
	| 'fix-checks'
	| 'update-from-main'
	| 'resolve-conflicts'
	| 'address-review'
	| 'check-compatibility'
	| 'update-docs'
	| 'open-draft'
	| 'merge'
	| 'reconcile';

type JobRunMode = 'off' | 'ask' | 'auto';

type JobTrigger = Readonly<{ when: string; mode: JobRunMode }>;

type JobDefinitionRecord = Readonly<{
	id: string;
	name: string;
	instructions: string;
	model: string;
	effort: AgentReasoningEffort;
	runsIn: JobRunsIn;
	skills: readonly string[];
	builtin: JobBuiltin | null;
	trigger: JobTrigger | null;
	thenJobId: string | null;
	createdAt: string;
	updatedAt: string;
}>;

type JobDefinitionChangedEvent = Readonly<{
	definitionId: string;
	definition: JobDefinitionRecord | null;
}>;
```

## `jobs:suggested`

Fires when Malini notices a prompt you keep repeating and suggests turning it into a job.

Payload: `JobSuggestedEvent`

```ts
type JobSuggestionStatus = 'open' | 'dismissed' | 'accepted';

type JobPromptEvidence = Readonly<{
	text: string;
	runId?: string;
	sessionId?: string;
	workstreamId?: string;
	submittedAt?: string;
}>;

type JobSuggestionRecord = Readonly<{
	id: string;
	clusterKey: string;
	status: JobSuggestionStatus;
	evidence: readonly JobPromptEvidence[];
	createdAt: string;
	updatedAt: string;
}>;

type JobSuggestedEvent = Readonly<{ suggestion: JobSuggestionRecord }>;
```

## `jobs:experiment-changed`

Fires when an experiment on a job's Improve page finishes replaying the job's recent tasks, with every result.

Payload: `JobExperimentChangedEvent`

```ts
type JobExperimentResult = Readonly<{
	outputId: string;
	output: string | null;
	error: string | null;
}>;

type JobExperimentRecord = Readonly<{
	id: string;
	definitionId: string;
	name: string;
	model: string;
	instructions: string;
	current: boolean;
	running: boolean;
	results: readonly JobExperimentResult[];
	createdAt: string;
}>;

type JobExperimentChangedEvent = Readonly<{ experiment: JobExperimentRecord }>;
```

## `jobs:agent-action-changed`

Fires when an agent calls one of Malini's tools, when the user denies the call, and when the call finishes, with the tool, its input, the approval and the outcome. Malini does not keep it in its event log: it keeps `jobs:tool-called`.

Payload: `AgentActionChangedEvent`

```ts
type AgentActionStatus = 'running' | 'succeeded' | 'failed' | 'denied';

type AgentActionApproval = 'not-needed' | 'allowed' | 'always-allowed' | 'denied';

type AgentActionRecord = Readonly<{
	id: string;
	sessionId: string;
	runId: string;
	workstreamId: string | null;
	tool: string;
	input: Readonly<Record<string, unknown>>;
	status: AgentActionStatus;
	approval: AgentActionApproval;
	output: string | null;
	startedAt: string;
	finishedAt: string | null;
}>;

type AgentActionChangedEvent = Readonly<{ action: AgentActionRecord }>;
```

## `jobs:tool-called`

Fires once when an agent calls one of Malini's tools, with the tool, its input and whether the call needed your yes.

Payload: `AgentActionChangedEvent`

```ts
type AgentActionStatus = 'running' | 'succeeded' | 'failed' | 'denied';

type AgentActionApproval = 'not-needed' | 'allowed' | 'always-allowed' | 'denied';

type AgentActionRecord = Readonly<{
	id: string;
	sessionId: string;
	runId: string;
	workstreamId: string | null;
	tool: string;
	input: Readonly<Record<string, unknown>>;
	status: AgentActionStatus;
	approval: AgentActionApproval;
	output: string | null;
	startedAt: string;
	finishedAt: string | null;
}>;

type AgentActionChangedEvent = Readonly<{ action: AgentActionRecord }>;
```

## `jobs:decision-changed`

Fires when the event reconciler decides what to do about an event no trigger handled, waits to wake a busy chat, asks you, or carries out what you picked, with the facts it saw, the candidates and the pick. Malini keeps it in the decision log, not in its event log.

Payload: `ReconcilerDecisionChangedEvent`

```ts
type ReconcilerCandidate =
	| Readonly<{ kind: 'nothing'; label: string }>
	| Readonly<{
			kind: 'wake-chat';
			label: string;
			sessionId: string;
			workstreamId: string;
			from: string;
			report: string;
	  }>
	| Readonly<{
			kind: 'run-job';
			label: string;
			definitionId: string;
			workstreamId: string;
			context: string;
	  }>
	| Readonly<{ kind: 'ask-you'; label: string; reason: string }>;

type ReconcilerDecider = 'model' | 'rules' | 'you';

type ReconcilerDecisionStatus = 'pending' | 'done' | 'asking' | 'dismissed' | 'failed';

type ReconcilerDecisionRecord = Readonly<{
	id: string;
	eventId: number;
	channel: string;
	chainId: string;
	workstreamId: string | null;
	facts: readonly string[];
	candidates: readonly ReconcilerCandidate[];
	pick: number | null;
	chosen: number;
	decidedBy: ReconcilerDecider;
	status: ReconcilerDecisionStatus;
	detail: string | null;
	jobRunId: string | null;
	createdAt: string;
	finishedAt: string | null;
}>;

type ReconcilerDecisionChangedEvent = Readonly<{ decision: ReconcilerDecisionRecord }>;
```

## `jobs:time-reached`

Fires when the time a job's schedule names comes, with the job, its schedule and the time it was due, once per time, and once on return for the latest time Malini missed while the Mac slept or Malini was closed. The reconciler's Schedules rule starts the job on it, unless the job's last run has not finished. It also fires with a `workstreamId` and a `wait` when a wait the Shipping rule set for that workstream ends: `retry` after a step failed, `checks` once a fix had a minute for its failing checks to run again.

Payload: `TimeReachedEvent`

```ts
type ScheduleTimeReached = Readonly<{
	definitionId: string;
	name: string;
	when: string;
	due: string;
}>;

type ShippingWait = 'retry' | 'checks';

type ShippingTimeReached = Readonly<{
	workstreamId: string;
	wait: ShippingWait;
	due: string;
}>;

type TimeReachedEvent = ScheduleTimeReached | ShippingTimeReached;
```

## `app:started`

Fires once each time Malini starts, as soon as its event log listens, with the version that started. The reconciler's Resume rule continues the chat turns a restart cut short on it, and its Shipping rule picks up every workstream it was shipping.

Payload: `AppStartedPayload`

```ts
type AppStartedPayload = Readonly<{ version: string }>;
```

## `app:close-requested`

Fires when you close the Malini window, so Malini can show what is still running and ask before it quits.

Payload: `EmptyEventPayload`

```ts
type EmptyEventPayload = Readonly<Record<string, never>>;
```

## `app:scale-changed`

Fires when the interface scale or the display the window sits on changes, so layouts can measure again. Malini does not keep it in its event log.

Payload: `EmptyEventPayload`

```ts
type EmptyEventPayload = Readonly<Record<string, never>>;
```

## `app:notification-opened`

Fires when you click a Malini notification, with the chat it points to.

Payload: `NotificationTarget`

```ts
type NotificationTarget = Readonly<{ workstreamId: string; sessionId: string }>;
```

## `app:menu-command-chosen`

Fires when you pick New Workstream, New Chat, Open Folder…, Clone Repository… or Settings… from Malini's menu bar or its menu bar icon, with which one you picked.

Payload: `MenuCommandChosen`

```ts
type MenuCommand = 'new-workstream' | 'new-chat' | 'open-folder' | 'clone-repository' | 'settings';

type MenuCommandChosen = Readonly<{ command: MenuCommand }>;
```

## `app:streaming-changed`

Fires when streamer mode turns on or off, because a screen recording or streaming app started or stopped.

Payload: `StreamingChangedPayload`

```ts
type StreamingChangedPayload = Readonly<{ streaming: boolean }>;
```

## `app:updated`

Fires once at startup after Malini updated to a new version whose events changed, with the old and new version and the events added, removed or whose payload changed.

Payload: `AppUpdatedPayload`

```ts
type ContractPayloadChange = Readonly<{ channel: string; before: string; after: string }>;

type ContractChanges = Readonly<{
	added: readonly string[];
	removed: readonly string[];
	changed: readonly ContractPayloadChange[];
}>;

type AppUpdatedPayload = Readonly<{ from: string; to: string; changes: ContractChanges }>;
```

## `app:update-staged`

Fires when a new Malini version has downloaded and installs on the next restart, with that version.

Payload: `UpdateStagedPayload`

```ts
type UpdateStagedPayload = Readonly<{ version: string }>;
```

## `browser:state-changed`

Fires whenever a workstream's browser tab changes its page, title, icon, loading state, history or load failure. Malini does not keep it in its event log.

Payload: `BrowserState`

```ts
type BrowserState = Readonly<{
	workstreamId: string;
	tabId: string;
	url: string;
	title: string;
	favicon: string | null;
	loading: boolean;
	canGoBack: boolean;
	canGoForward: boolean;
	failure: string | null;
}>;
```

## `browser:tab-opened`

Fires when a new browser tab opens in a workstream, for example when an agent opens a page.

Payload: `BrowserTabArgs`

```ts
type BrowserTabArgs = Readonly<{ workstreamId: string; tabId: string }>;
```

## `browser:resize-requested`

Fires when an agent asks to make the browser tab you see wider or narrower, with the width it asked for in Malini's pixels; Malini moves the divider between the chat and the inspector to match.

Payload: `BrowserResizeRequest`

```ts
type BrowserTabArgs = Readonly<{ workstreamId: string; tabId: string }>;

type BrowserResizeRequest = BrowserTabArgs & Readonly<{ requestId: string; width: number }>;
```

## `extensions:file-open-requested`

Fires when an agent opens a file for the user to edit, with the workstream, the file's path (relative to the worktree, or absolute outside it) and the line to show; Malini opens it in a File tab beside the workstream's chats.

Payload: `FileOpenRequestedPayload`

```ts
type FileOpenRequestedPayload = Readonly<{
	workstreamId: string;
	path: string;
	line: number | null;
}>;
```

## `stats:resources-sampled`

Fires every few seconds with a sample of the memory and CPU that Malini, its agents, browser tabs and containers use. Malini does not keep it in its event log.

Payload: `ResourceSample`

```ts
type ResourceKind = 'malini' | 'browser' | 'agents' | 'tools' | 'docker';

type ResourceUsage = Readonly<{
	kind: ResourceKind;
	memoryBytes: number;
	cpuPercent: number;
	processes: number;
}>;

type ResourceSample = Readonly<{
	sampledAt: number;
	memoryBytes: number;
	cpuPercent: number;
	processes: number;
	usage: readonly ResourceUsage[];
}>;
```

## `stats:workstream-running-changed`

Fires when what keeps running in any workstream changes, with every workstream that still runs background services, tasks or containers. Malini does not keep it in its event log.

Payload: `readonly WorkstreamRunning[]`

```ts
type RunningItemOrigin = 'agent' | 'docker';

type RunningItemKind = 'service' | 'task';

type RunningItem = Readonly<{
	id: string;
	origin: RunningItemOrigin;
	name: string;
	kind: RunningItemKind;
	detail: string;
	group: string | null;
	startedAt: number;
	ports: readonly number[];
}>;

type WorkstreamTurn = Readonly<{
	endedAt: number;
	outcome: string | null;
	need: string | null;
}>;

type WorkstreamRunning = Readonly<{
	workstreamId: string;
	items: readonly RunningItem[];
	behind: readonly string[];
	turn: WorkstreamTurn | null;
}>;
```
