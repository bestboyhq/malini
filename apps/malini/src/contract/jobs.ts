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
	| 'merge';

export type AutomaticJobBuiltin = 'name-chats' | 'name-services';

export type ShippingJobBuiltin =
	'fix-checks' | 'update-from-main' | 'resolve-conflicts' | 'address-review';

export type AgentlessJobBuiltin = 'update-from-main' | 'open-draft' | 'merge';

export function isAutomaticJobBuiltin(builtin: JobBuiltin | null): builtin is AutomaticJobBuiltin {
	return builtin === 'name-chats' || builtin === 'name-services';
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

export type JobRunOrigin = 'merge-queue' | 'manual' | 'trigger' | 'then';

export type JobRunRecord = Readonly<{
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
	parentRunId: string | null;
	chatSessionId: string | null;
	chatAfterRunId: string | null;
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
	context?: string;
	origin?: JobRunOrigin;
	parentRunId?: string;
	waitForYou?: boolean;
	chatSessionId?: string;
	chatAfterRunId?: string;
}>;

export type ChatJobRunsArgs = Readonly<{ chatSessionId: string }>;

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

export type JobCommandName =
	| 'jobs.list-definitions'
	| 'jobs.save-definition'
	| 'jobs.delete-definition'
	| 'jobs.reset-definition'
	| 'jobs.list-runs'
	| 'jobs.list-chat-runs'
	| 'jobs.run'
	| 'jobs.confirm-run'
	| 'jobs.cancel-run'
	| 'jobs.list-suggestions'
	| 'jobs.accept-suggestion'
	| 'jobs.dismiss-suggestion';

export type JobEventChannel = 'jobs:run-changed' | 'jobs:definition-changed' | 'jobs:suggested';

export type JobRunChangedEvent = Readonly<{ run: JobRunRecord }>;

export type JobDefinitionChangedEvent = Readonly<{
	definitionId: string;
	definition: JobDefinitionRecord | null;
}>;

export type JobSuggestedEvent = Readonly<{ suggestion: JobSuggestionRecord }>;

export const JOB_INTERRUPTED_DETAIL = 'Interrupted when Malini closed';

export const JOBS_MAX_CONCURRENT_SETTING = 'jobs.max-concurrent';

export const DEFAULT_JOBS_MAX_CONCURRENT = 3;

export const JOBS_MAX_CONCURRENT_RANGE = Object.freeze({ min: 1, max: 10 });
