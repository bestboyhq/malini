import type { PullRequestPhase } from '$lib/pull-requests/domain/pull-request-state';
import type { ProgressDot } from './lead-progress';

export type StatusSectionKey =
	'needs-you' | 'in-progress' | 'in-review' | 'idle' | 'stale' | 'merged';

export type DaySectionKey = 'today' | 'yesterday' | 'older';

export type SidebarSectionKey = StatusSectionKey | DaySectionKey;

type SectionChoice = Readonly<{ key: SidebarSectionKey; label: string }>;

export const SIDEBAR_SECTIONS: Readonly<Record<'status' | 'day', readonly SectionChoice[]>> = {
	status: [
		{ key: 'needs-you', label: 'Needs you' },
		{ key: 'in-progress', label: 'In progress' },
		{ key: 'in-review', label: 'In review' },
		{ key: 'idle', label: 'Idle' },
		{ key: 'stale', label: 'Stale' },
		{ key: 'merged', label: 'Merged' },
	],
	day: [
		{ key: 'today', label: 'Today' },
		{ key: 'yesterday', label: 'Yesterday' },
		{ key: 'older', label: 'Older' },
	],
};

export const STALE_AFTER_DAYS = 7;

export type StatusInput = Readonly<{
	dot: ProgressDot;
	pullRequest: PullRequestPhase;
	activeAt: number;
	now: number;
}>;

export function statusSection({ dot, pullRequest, activeAt, now }: StatusInput): StatusSectionKey {
	if (dot === 'blocked' || dot === 'needs' || dot === 'failed') return 'needs-you';
	if (dot === 'running') return 'in-progress';
	if (dot === 'merged') return 'merged';
	if (activeAt < startOfDay(now, STALE_AFTER_DAYS)) return 'stale';
	if (pullRequest === 'open' || pullRequest === 'draft') return 'in-review';
	return 'idle';
}

export function daySection(activeAt: number, now: number): DaySectionKey {
	if (activeAt >= startOfDay(now, 0)) return 'today';
	if (activeAt >= startOfDay(now, 1)) return 'yesterday';
	return 'older';
}

function startOfDay(now: number, daysAgo: number): number {
	const day = new Date(now);
	day.setHours(0, 0, 0, 0);
	day.setDate(day.getDate() - daysAgo);
	return day.getTime();
}
