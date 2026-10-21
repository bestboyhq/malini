---
title: Events
description: Every event Malini emits, when it fires, and the TypeScript shape of its payload.
---

# Events

Malini announces everything that happens on the platform as an event on a `<domain>:<event>` channel.
Routines can trigger on any of them, and agents inside Malini can list them with the `events_list` tool.
This page is generated from the contract in `apps/malini/src/contract/events.ts`, so it always matches the app.

## `chat:agent-event`

Fires for every event an agent run streams in a chat, such as text, tool calls, approvals and the end of the run, in sequence order.

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

## `repositories:workstream-created`

Fires when a new workstream exists: its git worktree is checked out and it is ready for chats.

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

## `repositories:clone-progress`

Fires repeatedly while Malini clones a repository, with the stage and the fraction done, and once more when it is done.

Payload: `CloneProgressPayload`

```ts
interface CloneProgressPayload {
	repo_id: string;
	stage: 'fetch' | 'checkout' | 'done';
	fraction: number;
}
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

Fires whenever a workstream's shipping state changes: its pull request phase, the merge queue step, or a reason it needs you.

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

## `jobs:run-changed`

Fires whenever a job run is queued, starts, needs you, or finishes as succeeded, failed or cancelled.

Payload: `JobRunChangedEvent`

```ts
type JobRunOrigin = 'merge-queue' | 'manual' | 'routine';

type JobRunStatus = 'queued' | 'running' | 'needs-you' | 'succeeded' | 'failed' | 'cancelled';

type JobRunRecord = Readonly<{
	id: string;
	definitionId: string;
	title: string;
	workstreamId: string | null;
	repositoryId: string | null;
	sessionId: string | null;
	agentRunId: string | null;
	origin: JobRunOrigin;
	status: JobRunStatus;
	detail: string | null;
	chatSessionId: string | null;
	chatAfterRunId: string | null;
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

type JobOutput = 'none' | 'draft' | 'merge';

type JobBuiltin =
	| 'name-chats'
	| 'name-services'
	| 'fix-checks'
	| 'update-from-main'
	| 'address-review'
	| 'check-compatibility'
	| 'update-docs';

type JobDefinitionRecord = Readonly<{
	id: string;
	name: string;
	instructions: string;
	model: string;
	effort: AgentReasoningEffort;
	runsIn: JobRunsIn;
	output: JobOutput;
	skills: readonly string[];
	builtin: JobBuiltin | null;
	createdAt: string;
	updatedAt: string;
}>;

type JobDefinitionChangedEvent = Readonly<{
	definitionId: string;
	definition: JobDefinitionRecord | null;
}>;
```

## `routines:suggested`

Fires when Malini notices a prompt you keep repeating and suggests turning it into a routine.

Payload: `RoutineSuggestedEvent`

```ts
type RoutineSuggestionStatus = 'open' | 'dismissed' | 'accepted';

type RoutinePromptEvidence = Readonly<{
	kind: 'prompt';
	text: string;
	runId?: string;
	sessionId?: string;
	workstreamId?: string;
	submittedAt?: string;
}>;

type RoutineSuggestionRecord = Readonly<{
	id: string;
	clusterKey: string;
	status: RoutineSuggestionStatus;
	evidence: readonly RoutinePromptEvidence[];
	createdAt: string;
	updatedAt: string;
}>;

type RoutineSuggestedEvent = Readonly<{
	suggestion: RoutineSuggestionRecord;
}>;
```

## `routines:changed`

Fires when a routine is created, updated, promoted, demoted or deleted; `routine` is `null` after a delete.

Payload: `RoutineChangedEvent`

```ts
type RoutineChange = 'created' | 'updated' | 'promoted' | 'demoted' | 'deleted';

type RoutineStatus = 'draft' | 'candidate' | 'routine';

type RoutineOrigin = 'user' | 'suggested';

type RoutineJsonValue =
	| string
	| number
	| boolean
	| null
	| readonly RoutineJsonValue[]
	| { readonly [key: string]: RoutineJsonValue };

type RoutineWorkflowRun = Readonly<{
	workflow: string;
	input: Readonly<Record<string, RoutineJsonValue>>;
}>;

type RoutineCommandRun = Readonly<{
	command: string;
	args: readonly RoutineJsonValue[];
}>;

type RoutineJobRun = Readonly<{ job: string }>;

type RoutineRun = RoutineWorkflowRun | RoutineCommandRun | RoutineJobRun;

type RoutinePromptEvidence = Readonly<{
	kind: 'prompt';
	text: string;
	runId?: string;
	sessionId?: string;
	workstreamId?: string;
	submittedAt?: string;
}>;

type RoutineRunEvidence = Readonly<{
	kind: 'run';
	runId: string;
	sessionId?: string;
	workstreamId?: string;
	summary?: string;
}>;

type RoutineEvidence = RoutinePromptEvidence | RoutineRunEvidence;

type RoutineRecord = Readonly<{
	id: string;
	status: RoutineStatus;
	origin: RoutineOrigin;
	label: string;
	when: string;
	steps: readonly RoutineRun[];
	evidence: readonly RoutineEvidence[];
	createdAt: string;
	updatedAt: string;
}>;

type RoutineChangedEvent = Readonly<{
	routineId: string;
	change: RoutineChange;
	routine: RoutineRecord | null;
}>;
```

## `routines:gated-run-changed`

Fires when a routine run waits for your confirmation, and again when you confirm or reject it.

Payload: `RoutineGatedRunChangedEvent`

```ts
type RoutineJsonValue =
	| string
	| number
	| boolean
	| null
	| readonly RoutineJsonValue[]
	| { readonly [key: string]: RoutineJsonValue };

type RoutineGatedRunState = 'pending' | 'confirmed' | 'rejected';

type RoutineGatedRunRecord = Readonly<{
	id: string;
	routineId: string;
	workstreamId: string;
	runKey: string;
	event: string;
	payload: RoutineJsonValue;
	state: RoutineGatedRunState;
	createdAt: string;
	decidedAt: string | null;
}>;

type RoutineGatedRunChangedEvent = Readonly<{
	gatedRun: RoutineGatedRunRecord;
}>;
```

## `app:close-requested`

Fires when you close the Malini window, so Malini can show what is still running and ask before it quits.

Payload: `EmptyEventPayload`

```ts
type EmptyEventPayload = Readonly<Record<string, never>>;
```

## `app:scale-changed`

Fires when the interface scale or the display the window sits on changes, so layouts can measure again.

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

Fires whenever a workstream's browser tab changes its page, title, icon, loading state, history or load failure.

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

## `stats:resources-sampled`

Fires every few seconds with a sample of the memory and CPU that Malini, its agents, browser tabs and containers use.

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

Fires when what keeps running in any workstream changes, with every workstream that still runs background services, tasks or containers.

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
