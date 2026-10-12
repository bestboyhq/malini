import type { AgentReasoningEffort } from '$contract/agent';
import type { JobOutput, JobRunsIn } from '$contract/jobs';
import { AGENT_REASONING_EFFORTS } from '$shared/providers/domain/run-profile';

export const JOB_NAME_MAX_LENGTH = 80;

export const JOB_INSTRUCTIONS_MAX_LENGTH = 20_000;

export function isJobEffort(value: unknown): value is AgentReasoningEffort {
	return AGENT_REASONING_EFFORTS.some((effort) => effort === value);
}

export function isJobRunsIn(value: unknown): value is JobRunsIn {
	return value === 'workstream' || value === 'new-workstream';
}

export function isJobOutput(value: unknown): value is JobOutput {
	return value === 'none' || value === 'draft' || value === 'merge';
}
