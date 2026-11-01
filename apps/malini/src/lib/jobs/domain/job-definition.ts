import type { AgentReasoningEffort } from '$contract/agent';
import type { JobBoundary, JobRunMode, JobRunsIn } from '$contract/jobs';
import { AGENT_REASONING_EFFORTS } from '$shared/providers/domain/run-profile';

export const JOB_NAME_MAX_LENGTH = 80;

export const JOB_INSTRUCTIONS_MAX_LENGTH = 20_000;

const SUGGESTED_JOB_NAME_LENGTH = 60;

export function isJobEffort(value: unknown): value is AgentReasoningEffort {
	return AGENT_REASONING_EFFORTS.some((effort) => effort === value);
}

export function isJobRunsIn(value: unknown): value is JobRunsIn {
	return value === 'workstream' || value === 'new-workstream';
}

export function isJobRunMode(value: unknown): value is JobRunMode {
	return value === 'off' || value === 'ask' || value === 'auto';
}

export function isJobBoundary(value: unknown): value is JobBoundary {
	if (typeof value !== 'object' || value === null) return false;
	const fields = new Map(Object.entries(value));
	const event = fields.get('event');
	const chats = fields.get('chats');
	return (
		(event === 'facts' || event === 'full') &&
		(chats === 'none' || chats === 'starter' || chats === 'all') &&
		['before', 'attachments', 'internet'].every((key) => typeof fields.get(key) === 'boolean')
	);
}

export function suggestedJobName(prompt: string): string {
	const line = prompt.split('\n')[0]?.replaceAll(/\s+/gu, ' ').trim() ?? '';
	return line.length > SUGGESTED_JOB_NAME_LENGTH
		? `${line.slice(0, SUGGESTED_JOB_NAME_LENGTH - 1).trimEnd()}…`
		: line;
}
