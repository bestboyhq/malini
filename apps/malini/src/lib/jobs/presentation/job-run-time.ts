import type { AgentActionRecord, JobRunRecord } from '$contract/jobs';
import { jobRunLastActivityAt } from '$lib/jobs/domain/job-run';

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function jobRunTime(run: JobRunRecord, nowMs: number): string {
	if (run.status === 'running') {
		return elapsed(nowMs - Date.parse(run.startedAt ?? run.createdAt));
	}
	return ago(nowMs - Date.parse(jobRunLastActivityAt(run)));
}

export function agentActionTime(action: AgentActionRecord, nowMs: number): string {
	if (action.status === 'running') return elapsed(nowMs - Date.parse(action.startedAt));
	return ago(nowMs - Date.parse(action.finishedAt ?? action.startedAt));
}

function elapsed(ms: number): string {
	const total = Number.isFinite(ms) ? Math.max(0, ms) : 0;
	const hours = Math.floor(total / HOUR_MS);
	const minutes = Math.floor((total % HOUR_MS) / MINUTE_MS);
	const seconds = Math.floor((total % MINUTE_MS) / SECOND_MS);
	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${seconds}s`;
	return `${seconds}s`;
}

function ago(ms: number): string {
	const total = Number.isFinite(ms) ? Math.max(0, ms) : 0;
	if (total < 45 * SECOND_MS) return 'just now';
	if (total < HOUR_MS) return `${Math.max(1, Math.round(total / MINUTE_MS))}m ago`;
	if (total < DAY_MS) return `${Math.floor(total / HOUR_MS)}h ago`;
	return `${Math.floor(total / DAY_MS)}d ago`;
}
