import type { AgentReasoningEffort } from './agent';

export type JobRunsIn = 'workstream' | 'new-workstream';

export type JobOutput = 'none' | 'draft' | 'merge';

export type JobBuiltin = 'fix-checks' | 'resolve-conflicts' | 'address-review';

export type JobDefinitionRecord = Readonly<{
	id: string;
	name: string;
	instructions: string;
	model: string;
	effort: AgentReasoningEffort;
	runsIn: JobRunsIn;
	output: JobOutput;
	builtin: JobBuiltin | null;
	createdAt: string;
	updatedAt: string;
}>;

export type JobRunStatus =
	'queued' | 'running' | 'needs-you' | 'succeeded' | 'failed' | 'cancelled';

export type JobRunOrigin = 'merge-queue' | 'manual' | 'routine';

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
	output: JobOutput;
}>;

export type JobDefinitionIdArgs = Readonly<{ definitionId: string }>;

export type RunJobArgs = Readonly<{
	definitionId: string;
	workstreamId?: string;
	repositoryId?: string;
	context?: string;
	origin?: JobRunOrigin;
}>;

export type JobRunIdArgs = Readonly<{ jobRunId: string }>;

export type JobCommandName =
	| 'jobs.list-definitions'
	| 'jobs.save-definition'
	| 'jobs.delete-definition'
	| 'jobs.reset-definition'
	| 'jobs.list-runs'
	| 'jobs.run'
	| 'jobs.cancel-run';

export type JobEventChannel = 'jobs:run-changed' | 'jobs:definition-changed';

export type JobRunChangedEvent = Readonly<{ run: JobRunRecord }>;

export type JobDefinitionChangedEvent = Readonly<{
	definitionId: string;
	definition: JobDefinitionRecord | null;
}>;

export const JOB_INTERRUPTED_DETAIL = 'Interrupted when malini closed';

export const JOBS_MAX_CONCURRENT_SETTING = 'jobs.max-concurrent';

export const DEFAULT_JOBS_MAX_CONCURRENT = 3;

export const JOBS_MAX_CONCURRENT_RANGE = Object.freeze({ min: 1, max: 10 });
