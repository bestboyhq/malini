import type { AgentReasoningEffort } from './agent';

export type JobRunsIn = 'workstream' | 'new-workstream';

export type JobRunMode = 'off' | 'ask' | 'auto';

export type JobTrigger = Readonly<{ when: string; mode: JobRunMode }>;

export type JobBuiltin =
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

export type AutomaticJobBuiltin = 'name-chats' | 'name-services' | 'reconcile';

export type ShippingJobBuiltin =
	'fix-checks' | 'update-from-main' | 'resolve-conflicts' | 'address-review';

export type AgentlessJobBuiltin = 'update-from-main' | 'open-draft' | 'merge';

export function isAutomaticJobBuiltin(builtin: JobBuiltin | null): builtin is AutomaticJobBuiltin {
	return builtin === 'name-chats' || builtin === 'name-services' || builtin === 'reconcile';
}

export function isShippingJobBuiltin(builtin: JobBuiltin | null): builtin is ShippingJobBuiltin {
	return (
		builtin === 'fix-checks' ||
		builtin === 'update-from-main' ||
		builtin === 'resolve-conflicts' ||
		builtin === 'address-review'
	);
}

export function isAgentlessJobBuiltin(builtin: JobBuiltin | null): builtin is AgentlessJobBuiltin {
	return builtin === 'update-from-main' || builtin === 'open-draft' || builtin === 'merge';
}

export type JobDefinitionRecord = Readonly<{
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

export type JobRunStatus =
	'waiting' | 'queued' | 'running' | 'needs-you' | 'succeeded' | 'failed' | 'cancelled';

export type JobRunOrigin =
	'merge-queue' | 'manual' | 'trigger' | 'then' | 'schedule' | 'reconciler';

export type JobRunRecord = Readonly<{
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

export type SaveJobDefinitionArgs = Readonly<{
	id?: string;
	name: string;
	instructions: string;
	model: string;
	effort: AgentReasoningEffort;
	runsIn: JobRunsIn;
	skills?: readonly string[];
	trigger?: JobTrigger | null;
	thenJobId?: string | null;
}>;

export type JobDefinitionIdArgs = Readonly<{ definitionId: string }>;

export type RunJobArgs = Readonly<{
	definitionId: string;
	workstreamId?: string;
	repositoryId?: string;
	scope?: string;
	context?: string;
	origin?: JobRunOrigin;
	parentRunId?: string;
	waitForYou?: boolean;
	chatSessionId?: string;
	chatAfterRunId?: string;
	causeEventId?: number;
}>;

export type JobRunIdArgs = Readonly<{ jobRunId: string }>;

export type JobPromptEvidence = Readonly<{
	text: string;
	runId?: string;
	sessionId?: string;
	workstreamId?: string;
	submittedAt?: string;
}>;

export type JobSuggestionStatus = 'open' | 'dismissed' | 'accepted';

export type JobSuggestionRecord = Readonly<{
	id: string;
	clusterKey: string;
	status: JobSuggestionStatus;
	evidence: readonly JobPromptEvidence[];
	createdAt: string;
	updatedAt: string;
}>;

export type JobSuggestionIdArgs = Readonly<{ suggestionId: string }>;

export type JobOutputRecord = Readonly<{
	id: string;
	setupId: string;
	excerpt: string;
	output: string | null;
	error: string | null;
	createdAt: string;
}>;

export type JobSetupRecord = Readonly<{
	id: string;
	model: string;
	instructions: string;
	expectedRate: number | null;
	createdAt: string;
}>;

export type JobOutputsArgs = Readonly<{ definitionId: string; since: string }>;

export type JobExperimentResult = Readonly<{
	outputId: string;
	output: string | null;
	error: string | null;
}>;

export type JobExperimentRecord = Readonly<{
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

export type JobExperimentsRecord = Readonly<{
	definitionId: string;
	sample: readonly JobOutputRecord[];
	experiments: readonly JobExperimentRecord[];
}>;

export type SaveJobExperimentArgs = Readonly<{
	definitionId: string;
	experimentId?: string;
	model: string;
	instructions: string;
}>;

export type JobExperimentIdArgs = Readonly<{ experimentId: string }>;

export type JobCommandName =
	| 'jobs.list-definitions'
	| 'jobs.save-definition'
	| 'jobs.delete-definition'
	| 'jobs.reset-definition'
	| 'jobs.list-runs'
	| 'jobs.run'
	| 'jobs.confirm-run'
	| 'jobs.cancel-run'
	| 'jobs.list-suggestions'
	| 'jobs.accept-suggestion'
	| 'jobs.dismiss-suggestion'
	| 'jobs.list-outputs'
	| 'jobs.list-setups'
	| 'jobs.open-experiments'
	| 'jobs.save-experiment'
	| 'jobs.delete-experiment'
	| 'jobs.run-experiment'
	| 'jobs.use-experiment'
	| 'jobs.list-agent-actions'
	| 'jobs.list-chat-turns'
	| 'jobs.list-decisions'
	| 'jobs.decide'
	| 'jobs.list-timeline';

export type JobEventChannel =
	| 'jobs:run-changed'
	| 'jobs:definition-changed'
	| 'jobs:suggested'
	| 'jobs:experiment-changed'
	| 'jobs:agent-action-changed'
	| 'jobs:decision-changed';

export type JobRunChangedEvent = Readonly<{ run: JobRunRecord }>;

export type AgentActionStatus = 'running' | 'succeeded' | 'failed' | 'denied';

export type AgentActionApproval = 'not-needed' | 'allowed' | 'always-allowed' | 'denied';

export type AgentActionRecord = Readonly<{
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

export type AgentActionChangedEvent = Readonly<{ action: AgentActionRecord }>;

export type ChatTurnStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';

export type ChatTurnRecord = Readonly<{
	runId: string;
	sessionId: string;
	workstreamId: string;
	chatName: string;
	prompt: string;
	status: ChatTurnStatus;
	chainId: string;
	causeEventId: number | null;
	startedAt: string;
	finishedAt: string | null;
}>;

export type ListChatTurnsArgs = Readonly<{ every: boolean }>;

export type JobDefinitionChangedEvent = Readonly<{
	definitionId: string;
	definition: JobDefinitionRecord | null;
}>;

export type JobSuggestedEvent = Readonly<{ suggestion: JobSuggestionRecord }>;

export type JobExperimentChangedEvent = Readonly<{ experiment: JobExperimentRecord }>;

export type EventCauseKind = 'job-run' | 'chat-turn';

export type EventCause = Readonly<{ kind: EventCauseKind; id: string }>;

export type LoggedEventRecord = Readonly<{
	id: number;
	channel: string;
	payload: unknown;
	workstreamId: string | null;
	cause: EventCause | null;
	chainId: string;
	emittedAt: string;
}>;

export type ReconcilerCandidate =
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

export type ReconcilerDecisionStatus = 'pending' | 'done' | 'asking' | 'dismissed' | 'failed';

export type ReconcilerDecider = 'model' | 'rules' | 'you';

export type ReconcilerDecisionRecord = Readonly<{
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

export type ReconcilerDecisionChangedEvent = Readonly<{ decision: ReconcilerDecisionRecord }>;

export type DecideArgs = Readonly<{ decisionId: string; candidate: number }>;

export type ListTimelineArgs = Readonly<{ since: string }>;

export type TimelineJobRun = JobRunRecord & Readonly<{ eventIds: readonly number[] }>;

export type TimelineChatTurn = ChatTurnRecord & Readonly<{ from: string | null; resumed: boolean }>;

export type TimelineWorkstream = Readonly<{
	id: string;
	name: string;
	repository: string | null;
	startedBy: string | null;
}>;

export type TimelineRecord = Readonly<{
	since: string;
	until: string;
	events: readonly LoggedEventRecord[];
	channelCounts: Readonly<Record<string, number>>;
	runs: readonly TimelineJobRun[];
	turns: readonly TimelineChatTurn[];
	decisions: readonly ReconcilerDecisionRecord[];
	workstreams: readonly TimelineWorkstream[];
}>;

export const JOB_INTERRUPTED_DETAIL = 'Interrupted when Malini closed';

export const JOBS_RECONCILER_SETTING = 'jobs.reconciler';

export type ReconcilerMode = 'on' | 'off';

export function reconcilerMode(stored: string | null | undefined): ReconcilerMode {
	return stored === 'off' ? 'off' : 'on';
}

export const JOBS_MAX_CONCURRENT_SETTING = 'jobs.max-concurrent';

export const DEFAULT_JOBS_MAX_CONCURRENT = 3;

export const JOBS_MAX_CONCURRENT_RANGE = Object.freeze({ min: 1, max: 10 });
