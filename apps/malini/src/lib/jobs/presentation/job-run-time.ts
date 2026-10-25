import { scheduleTime } from '$contract/automation-trigger';
import type { JobRunRecord } from '$contract/jobs';
import { jobRunLastActivityAt } from '$lib/jobs/domain/job-run';

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const WEEKDAY_FORMAT = new Intl.DateTimeFormat('en-US', { weekday: 'short' });

export function jobRunTime(run: JobRunRecord, nowMs: number): string {
	if (run.status === 'running') {
		return elapsed(nowMs - Date.parse(run.startedAt ?? run.createdAt));
	}
	return ago(nowMs - Date.parse(jobRunLastActivityAt(run)));
}

export function activityTime(
	entry: Readonly<{ status: string; startedAt: string; finishedAt: string | null }>,
	nowMs: number,
): string {
	if (entry.status === 'running') return elapsed(nowMs - Date.parse(entry.startedAt));
	return ago(nowMs - Date.parse(entry.finishedAt ?? entry.startedAt));
}

export function upcomingTime(
	slotMs: number,
	nowMs: number,
): Readonly<{ day: string; time: string }> {
	const slot = new Date(slotMs);
	const daysAhead = Math.round((startOfDay(slot) - startOfDay(new Date(nowMs))) / DAY_MS);
	const day =
		daysAhead === 0 ? 'Today' : daysAhead === 1 ? 'Tomorrow' : WEEKDAY_FORMAT.format(slot);
	return { day, time: scheduleTime({ hour: slot.getHours(), minute: slot.getMinutes() }) };
}

function startOfDay(date: Date): number {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
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
