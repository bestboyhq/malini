import {
	DEFAULT_JOBS_MAX_CONCURRENT,
	JOBS_MAX_CONCURRENT_RANGE,
	type JobRunOrigin,
	type JobRunStatus,
} from '$contract/jobs';
import { isAlreadyActiveError } from '$lib/chat/domain/prompt-dispatch-failure';

export const JOB_CONTEXT_MAX_BYTES = 64 * 1024;

export const JOB_INTERRUPTED_DETAIL = 'Interrupted when malini closed';

export function isFinishedJobRunStatus(status: JobRunStatus): boolean {
	return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

export function isJobRunOrigin(value: unknown): value is JobRunOrigin {
	return value === 'merge-queue' || value === 'manual' || value === 'routine';
}

export function jobPrompt(instructions: string, context: string | null): string {
	return context ? `${instructions}\n\n${context}` : instructions;
}

export function jobsMaxConcurrent(setting: string | null | undefined): number {
	const parsed = Number.parseInt(setting ?? '', 10);
	if (Number.isNaN(parsed)) return DEFAULT_JOBS_MAX_CONCURRENT;
	return Math.min(JOBS_MAX_CONCURRENT_RANGE.max, Math.max(JOBS_MAX_CONCURRENT_RANGE.min, parsed));
}

export function workstreamWasBusy(error: unknown): boolean {
	return error instanceof Error && isAlreadyActiveError(error.message);
}
