import type { AgentReasoningEffort } from './agent';
import type { RunEnding } from './agent-state-machine';

export type AutomationRunsIn = 'workstream' | 'new-workstream';

export type AutomationRunMode = 'off' | 'ask' | 'auto';

export type AutomationTrigger = Readonly<{ when: string; mode: AutomationRunMode }>;

export type AutomationBuiltin =
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
	| 'reconcile'
	| 'suggest-automations'
	| 'capture-brain'
	| 'write-brain-notes';

export type OneShotAutomationBuiltin =
	'name-chats' | 'name-services' | 'reconcile' | 'suggest-automations';

export type ShippingAutomationBuiltin =
	'fix-checks' | 'update-from-main' | 'resolve-conflicts' | 'address-review';

export type AgentlessAutomationBuiltin =
	'update-from-main' | 'open-draft' | 'merge' | 'capture-brain';

export type BrainAutomationBuiltin = 'capture-brain' | 'write-brain-notes';

export function isOneShotAutomationBuiltin(
	builtin: AutomationBuiltin | null,
): builtin is OneShotAutomationBuiltin {
	return (
		builtin === 'name-chats' ||
		builtin === 'name-services' ||
		builtin === 'reconcile' ||
		builtin === 'suggest-automations'
	);
}

export function isShippingAutomationBuiltin(
	builtin: AutomationBuiltin | null,
): builtin is ShippingAutomationBuiltin {
	return (
		builtin === 'fix-checks' ||
		builtin === 'update-from-main' ||
		builtin === 'resolve-conflicts' ||
		builtin === 'address-review'
	);
}

export function isAgentlessAutomationBuiltin(
	builtin: AutomationBuiltin | null,
): builtin is AgentlessAutomationBuiltin {
	return (
		builtin === 'update-from-main' ||
		builtin === 'open-draft' ||
		builtin === 'merge' ||
		builtin === 'capture-brain'
	);
}

export function isBrainAutomationBuiltin(
	builtin: AutomationBuiltin | null,
): builtin is BrainAutomationBuiltin {
	return builtin === 'capture-brain' || builtin === 'write-brain-notes';
}

export type AutomationEventSight = 'facts' | 'full';

export type AutomationChatSight = 'none' | 'starter' | 'all';

export type AutomationBoundary = Readonly<{
	event: AutomationEventSight;
	before: boolean;
	chats: AutomationChatSight;
	attachments: boolean;
	internet: boolean;
}>;

export const DEFAULT_AUTOMATION_BOUNDARY: AutomationBoundary = {
	event: 'facts',
	before: true,
	chats: 'none',
	attachments: false,
	internet: true,
};

export const NEW_AUTOMATION_BOUNDARY: AutomationBoundary = {
	...DEFAULT_AUTOMATION_BOUNDARY,
	internet: false,
};

export type AutomationDefinitionRecord = Readonly<{
	id: string;
	name: string;
	instructions: string;
	provider: string;
	model: string;
	effort: AgentReasoningEffort;
	runsIn: AutomationRunsIn;
	skills: readonly string[];
	builtin: AutomationBuiltin | null;
	trigger: AutomationTrigger | null;
	thenAutomationId: string | null;
	boundary: AutomationBoundary;
	createdAt: string;
	updatedAt: string;
}>;

export const AUTOMATION_RUN_STATUSES = [
	'waiting',
	'queued',
	'running',
	'needs-you',
	'succeeded',
	'failed',
	'cancelled',
] as const;

export type AutomationRunStatus = (typeof AUTOMATION_RUN_STATUSES)[number];

export const UNFINISHED_AUTOMATION_RUN_STATUSES: readonly AutomationRunStatus[] = [
	'waiting',
	'queued',
	'running',
	'needs-you',
];

export const ACTIVE_AUTOMATION_RUN_STATUSES: readonly AutomationRunStatus[] = [
	'running',
	'needs-you',
];

export const PENDING_AUTOMATION_RUN_STATUSES: readonly AutomationRunStatus[] = [
	'waiting',
	'queued',
];

export const AUTOMATION_RUN_ORIGINS = [
	'merge-queue',
	'manual',
	'trigger',
	'then',
	'schedule',
	'reconciler',
	'compatibility',
] as const;

export type AutomationRunOrigin = (typeof AUTOMATION_RUN_ORIGINS)[number];

export type AutomationRunRecord = Readonly<{
	id: string;
	definitionId: string;
	title: string;
	workstreamId: string | null;
	repositoryId: string | null;
	scope: string | null;
	sessionId: string | null;
	agentRunId: string | null;
	origin: AutomationRunOrigin;
	status: AutomationRunStatus;
	interrupted: boolean;
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

export type SaveAutomationDefinitionArgs = Readonly<{
	id?: string;
	name: string;
	instructions: string;
	provider: string;
	model: string;
	effort: AgentReasoningEffort;
	runsIn: AutomationRunsIn;
	skills?: readonly string[];
	trigger?: AutomationTrigger | null;
	thenAutomationId?: string | null;
	boundary?: AutomationBoundary;
}>;

export type AutomationDefinitionIdArgs = Readonly<{ definitionId: string }>;

export type RunAutomationArgs = Readonly<{
	definitionId: string;
	workstreamId?: string;
	repositoryId?: string;
	scope?: string;
	context?: string;
	origin?: AutomationRunOrigin;
	parentRunId?: string;
	waitForYou?: boolean;
	chatSessionId?: string;
	chatAfterRunId?: string;
	causeEventId?: number;
}>;

export type AutomationRunIdArgs = Readonly<{ automationRunId: string }>;

export type AutomationAskRecord = Readonly<{
	text: string;
	workstreamId: string;
	pullRequestNumber: number | null;
	askedAt: string;
}>;

export const AUTOMATION_SUGGESTION_STATUSES = ['open', 'dismissed', 'accepted'] as const;

export type AutomationSuggestionStatus = (typeof AUTOMATION_SUGGESTION_STATUSES)[number];

export type AutomationSuggestionRecord = Readonly<{
	id: string;
	repositoryId: string;
	sessionId: string;
	afterRunId: string;
	name: string;
	instructions: string;
	when: string;
	status: AutomationSuggestionStatus;
	definitionId: string | null;
	asks: readonly AutomationAskRecord[];
	createdAt: string;
	updatedAt: string;
}>;

export type AutomationSuggestionIdArgs = Readonly<{ suggestionId: string }>;

export type AcceptAutomationSuggestionArgs = Readonly<{
	suggestionId: string;
	automation?: Omit<SaveAutomationDefinitionArgs, 'id'>;
}>;

export type AcceptedAutomationSuggestion = Readonly<{
	suggestion: AutomationSuggestionRecord;
	automation: AutomationDefinitionRecord;
}>;

export type AutomationOutputRecord = Readonly<{
	id: string;
	setupId: string;
	excerpt: string;
	output: string | null;
	error: string | null;
	createdAt: string;
}>;

export type AutomationSetupRecord = Readonly<{
	id: string;
	provider: string;
	model: string;
	instructions: string;
	expectedRate: number | null;
	createdAt: string;
}>;

export type AutomationOutputsArgs = Readonly<{ definitionId: string; since: string }>;

export type AutomationExperimentResult = Readonly<{
	outputId: string;
	output: string | null;
	error: string | null;
}>;

export type AutomationExperimentRecord = Readonly<{
	id: string;
	definitionId: string;
	name: string;
	provider: string;
	model: string;
	instructions: string;
	current: boolean;
	running: boolean;
	results: readonly AutomationExperimentResult[];
	createdAt: string;
}>;

export type AutomationExperimentsRecord = Readonly<{
	definitionId: string;
	sample: readonly AutomationOutputRecord[];
	experiments: readonly AutomationExperimentRecord[];
}>;

export type SaveAutomationExperimentArgs = Readonly<{
	definitionId: string;
	experimentId?: string;
	provider: string;
	model: string;
	instructions: string;
}>;

export type AutomationExperimentIdArgs = Readonly<{ experimentId: string }>;

export type AutomationCommandName =
	| 'automations.list-definitions'
	| 'automations.save-definition'
	| 'automations.delete-definition'
	| 'automations.reset-definition'
	| 'automations.list-runs'
	| 'automations.run'
	| 'automations.confirm-run'
	| 'automations.cancel-run'
	| 'automations.list-suggestions'
	| 'automations.accept-suggestion'
	| 'automations.dismiss-suggestion'
	| 'automations.list-outputs'
	| 'automations.list-setups'
	| 'automations.open-experiments'
	| 'automations.save-experiment'
	| 'automations.delete-experiment'
	| 'automations.run-experiment'
	| 'automations.use-experiment'
	| 'automations.list-agent-actions'
	| 'automations.list-chat-turns'
	| 'automations.list-decisions'
	| 'automations.decide'
	| 'automations.list-timeline';

export type AutomationEventChannel =
	| 'automations:run-changed'
	| 'automations:run-started'
	| 'automations:run-finished'
	| 'automations:definition-changed'
	| 'automations:suggested'
	| 'automations:experiment-changed'
	| 'automations:agent-action-changed'
	| 'automations:tool-called'
	| 'automations:decision-changed';

export type AutomationRunChangedEvent = Readonly<{ run: AutomationRunRecord }>;

export type ScheduleTimeReached = Readonly<{
	definitionId: string;
	name: string;
	when: string;
	due: string;
}>;

export type ShippingWait = 'retry' | 'checks' | 'idle';

export type ShippingTimeReached = Readonly<{
	workstreamId: string;
	wait: ShippingWait;
	due: string;
	causeEventId?: number;
}>;

export type ResumeTimeReached = Readonly<{
	workstreamId: string;
	sessionId: string;
	runId: string;
	wait: 'resume';
	due: string;
}>;

export type AlarmTimeReached = ShippingTimeReached | ResumeTimeReached;

export type TimeReachedEvent = ScheduleTimeReached | AlarmTimeReached;

export const AGENT_ACTION_STATUSES = ['running', 'succeeded', 'failed', 'denied'] as const;

export type AgentActionStatus = (typeof AGENT_ACTION_STATUSES)[number];

export const AGENT_ACTION_APPROVALS = [
	'not-needed',
	'allowed',
	'always-allowed',
	'denied',
] as const;

export type AgentActionApproval = (typeof AGENT_ACTION_APPROVALS)[number];

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

export type ChatTurnStatus = 'running' | RunEnding;

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

export type AutomationDefinitionChangedEvent = Readonly<{
	definitionId: string;
	definition: AutomationDefinitionRecord | null;
}>;

export type AutomationSuggestedEvent = Readonly<{ suggestion: AutomationSuggestionRecord }>;

export type AutomationExperimentChangedEvent = Readonly<{ experiment: AutomationExperimentRecord }>;

export type EventCauseKind = 'automation-run' | 'chat-turn' | 'event';

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

export type WakeAbout = 'workstream' | 'automation' | 'conflict';

export type ReconcilerCandidate =
	| Readonly<{ kind: 'nothing'; label: string }>
	| Readonly<{
			kind: 'wake-chat';
			label: string;
			sessionId: string;
			workstreamId: string;
			from: string;
			report: string;
			about?: WakeAbout;
	  }>
	| Readonly<{
			kind: 'run-automation';
			label: string;
			definitionId: string;
			workstreamId: string;
			context: string;
	  }>
	| Readonly<{ kind: 'ask-you'; label: string; reason: string }>;

export const RECONCILER_DECISION_STATUSES = [
	'pending',
	'done',
	'asking',
	'dismissed',
	'failed',
] as const;

export type ReconcilerDecisionStatus = (typeof RECONCILER_DECISION_STATUSES)[number];

export const RECONCILER_DECIDERS = ['model', 'rules', 'you'] as const;

export type ReconcilerDecider = (typeof RECONCILER_DECIDERS)[number];

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
	automationRunId: string | null;
	subjectRunId: string | null;
	createdAt: string;
	finishedAt: string | null;
}>;

export type ReconcilerDecisionChangedEvent = Readonly<{ decision: ReconcilerDecisionRecord }>;

export type DecideArgs = Readonly<{ decisionId: string; candidate: number }>;

export type ListTimelineArgs = Readonly<{ since: string }>;

export type TimelineAutomationRun = AutomationRunRecord & Readonly<{ eventIds: readonly number[] }>;

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
	runs: readonly TimelineAutomationRun[];
	turns: readonly TimelineChatTurn[];
	decisions: readonly ReconcilerDecisionRecord[];
	workstreams: readonly TimelineWorkstream[];
}>;

export const AUTOMATION_INTERRUPTED_DETAIL = 'Interrupted when Malini closed';

export function automationRunInterrupted(
	run: Pick<AutomationRunRecord, 'status' | 'interrupted'>,
): boolean {
	return run.status === 'failed' && run.interrupted;
}

export const AUTOMATIONS_MAX_CONCURRENT_SETTING = 'automations.max-concurrent';

export const DEFAULT_AUTOMATIONS_MAX_CONCURRENT = 3;

export const AUTOMATIONS_MAX_CONCURRENT_RANGE = Object.freeze({ min: 1, max: 10 });
