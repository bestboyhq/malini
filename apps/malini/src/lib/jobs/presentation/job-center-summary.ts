import { upcomingTime } from './job-run-time';

type JobCenterCounts = Readonly<{
	running: number;
	queued: number;
	needsYou: number;
	finished: number;
	nextAt: number | null;
}>;

export function jobCenterSummary(counts: JobCenterCounts, nowMs: number): string {
	const parts = [
		counts.running > 0 ? `${counts.running} running` : null,
		counts.queued > 0 ? `${counts.queued} queued` : null,
		counts.needsYou > 0
			? `${counts.needsYou} ${counts.needsYou === 1 ? 'needs' : 'need'} you`
			: null,
	].filter((part) => part !== null);
	if (parts.length > 0) return parts.join(', ');
	if (counts.nextAt !== null) return nextRun(counts.nextAt, nowMs);
	if (counts.finished > 0) return `${counts.finished} finished recently`;
	return 'ready when you are';
}

function nextRun(nextAt: number, nowMs: number): string {
	const { day, time } = upcomingTime(nextAt, nowMs);
	if (day === 'Today' || day === 'Tomorrow') return `next at ${time} ${day.toLowerCase()}`;
	return `next ${day} at ${time}`;
}
