import {
	DEFAULT_JOBS_MAX_CONCURRENT,
	JOBS_MAX_CONCURRENT_RANGE,
	type JobRunOrigin,
	type JobRunRecord,
	type JobRunStatus,
} from '$contract/jobs';
import { isAlreadyActiveError } from '$lib/chat/domain/prompt-dispatch-failure';

export const JOB_CONTEXT_MAX_BYTES = 64 * 1024;

export const JOB_CHAIN_MAX_DEPTH = 32;

export function isFinishedJobRunStatus(status: JobRunStatus): boolean {
	return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

export function jobRunLastActivityAt(
	run: Pick<JobRunRecord, 'createdAt' | 'startedAt' | 'finishedAt'>,
): string {
	return run.finishedAt ?? run.startedAt ?? run.createdAt;
}

export function isJobRunOrigin(value: unknown): value is JobRunOrigin {
	return value === 'merge-queue' || value === 'manual' || value === 'trigger' || value === 'then';
}

export function jobPrompt(instructions: string, context: string | null): string {
	return context ? `${instructions}\n\n${context}` : instructions;
}

export function truncateJobContext(text: string): string {
	const { read } = new TextEncoder().encodeInto(text, new Uint8Array(JOB_CONTEXT_MAX_BYTES));
	return text.slice(0, read);
}

export function jobsMaxConcurrent(setting: string | null | undefined): number {
	const parsed = Number.parseInt(setting ?? '', 10);
	if (Number.isNaN(parsed)) return DEFAULT_JOBS_MAX_CONCURRENT;
	return Math.min(JOBS_MAX_CONCURRENT_RANGE.max, Math.max(JOBS_MAX_CONCURRENT_RANGE.min, parsed));
}

export function workstreamWasBusy(error: unknown): boolean {
	return error instanceof Error && isAlreadyActiveError(error.message);
}
