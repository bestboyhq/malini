import { parseAutomationTrigger } from '$contract/automation-trigger';
import type { EventChannel } from '$contract/events';
import {
	isAgentlessJobBuiltin,
	isAutomaticJobBuiltin,
	type JobBoundary,
	type JobDefinitionRecord,
} from '$contract/jobs';

type BoundaryJob = Pick<
	JobDefinitionRecord,
	'id' | 'builtin' | 'trigger' | 'thenJobId' | 'boundary'
>;

export const WORDLESS_BOUNDARY: Pick<JobBoundary, 'event' | 'before' | 'chats' | 'attachments'> = {
	event: 'facts',
	before: false,
	chats: 'none',
	attachments: false,
};

export function runsAnAgent(job: Pick<JobDefinitionRecord, 'builtin'>): boolean {
	return !isAgentlessJobBuiltin(job.builtin) && !isAutomaticJobBuiltin(job.builtin);
}

export function triggerChannel(job: Pick<JobDefinitionRecord, 'trigger'>): EventChannel | null {
	const when = job.trigger?.when;
	if (!when?.startsWith('on ')) return null;
	const trigger = parseAutomationTrigger(when);
	return trigger.kind === 'event' ? trigger.channel : null;
}

export function jobsBefore<T extends BoundaryJob>(job: BoundaryJob, jobs: readonly T[]): T[] {
	return jobs.filter((other) => other.thenJobId === job.id && other.id !== job.id);
}

export function seesYourWords(
	job: BoundaryJob,
	jobs: readonly BoundaryJob[],
	visited: ReadonlySet<string> = new Set(),
): boolean {
	if (!runsAnAgent(job) || visited.has(job.id)) return false;
	const { event, before, chats, attachments } = job.boundary;
	if (chats !== 'none' || attachments) return true;
	if (event === 'full' && triggerChannel(job) !== null) return true;
	const seen = new Set([...visited, job.id]);
	return before && jobsBefore(job, jobs).some((other) => seesYourWords(other, jobs, seen));
}

export function publishingThen<T extends BoundaryJob>(
	job: BoundaryJob,
	jobs: readonly T[],
): T | null {
	const then = jobs.find((other) => other.id === job.thenJobId);
	return then?.builtin === 'open-draft' || then?.builtin === 'merge' ? then : null;
}

export function canLeak(job: BoundaryJob, jobs: readonly BoundaryJob[]): boolean {
	return seesYourWords(job, jobs) && (job.boundary.internet || publishingThen(job, jobs) !== null);
}
