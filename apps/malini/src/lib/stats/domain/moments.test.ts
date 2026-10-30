import { describe, expect, it } from 'vitest';
import type { PublishedStats, StatsMoment } from '$contract/stats';
import { shiftDate } from './activity';
import { recentMoments, unseenMoment } from './moments';

const THROUGH = '2026-10-29';
const NO_PERCENTILES = { p50: 0, p90: 0, max: 0 };

function stats(
	runsByDay: readonly (readonly [string, number])[],
	totalRuns?: number,
): PublishedStats {
	return {
		version: 1,
		through: THROUGH,
		since: runsByDay[0]?.[0] ?? THROUGH,
		totals: {
			runs: totalRuns ?? runsByDay.reduce((sum, [, runs]) => sum + runs, 0),
			jobRuns: 0,
			automatedRuns: 0,
			changeRuns: 0,
			activeDays: runsByDay.length,
			toolCalls: 0,
			screenshots: 0,
			workstreams: 0,
			mergedPullRequests: 0,
			linesAdded: 0,
			linesDeleted: 0,
			filesChanged: 0,
			inputTokens: 0,
			outputTokens: 0,
		},
		days: runsByDay.map(([date, runs]) => ({ date, runs, agents: 1 })),
		intensity: {
			agents: { mean: 1, p50: 1, p90: 1, max: 1 },
			runSeconds: NO_PERCENTILES,
			steps: NO_PERCENTILES,
			runsPerActiveDay: NO_PERCENTILES,
			linesPerChange: { p50: 0 },
			runsPerWorkstream: { p50: 0 },
		},
		repositories: [],
		otherRepositories: {
			public: { repositories: 0, runs: 0 },
			private: { repositories: 0, runs: 0 },
		},
	};
}

function streakEnding(last: string, length: number, runs = 2): [string, number][] {
	return Array.from({ length }, (_, index) => [shiftDate(last, index + 1 - length), runs]);
}

function streakEndingYesterday(length: number, runs = 2): [string, number][] {
	return streakEnding(THROUGH, length, runs);
}

describe('recentMoments', () => {
	it('marks a streak milestone whether or not an earlier streak was longer', () => {
		expect(recentMoments(stats(streakEndingYesterday(7)))).toEqual([
			{ id: 'streak:2026-10-23:7', kind: 'streak', count: 7, date: THROUGH },
		]);
		const earlierLongStreak: [string, number][] = Array.from({ length: 9 }, (_, index) => [
			shiftDate('2026-09-01', index),
			2,
		]);
		expect(
			recentMoments(stats([...earlierLongStreak, ...streakEndingYesterday(7)])).map(
				({ kind, count }) => [kind, count],
			),
		).toEqual([['streak', 7]]);
	});

	it('marks the first day a streak beats the longest one before it, and keeps it for the week after', () => {
		const earlier: [string, number][] = Array.from({ length: 10 }, (_, index) => [
			shiftDate('2026-08-01', index),
			2,
		]);
		expect(recentMoments(stats([...earlier, ...streakEndingYesterday(11)]))).toEqual([
			{ id: 'streak:2026-10-19:11', kind: 'streak', count: 11, date: THROUGH },
			{ id: 'streak:2026-10-19:7', kind: 'streak', count: 7, date: '2026-10-25' },
		]);
		expect(recentMoments(stats([...earlier, ...streakEndingYesterday(12)]))).toEqual([
			{ id: 'streak:2026-10-18:11', kind: 'streak', count: 11, date: '2026-10-28' },
			{ id: 'streak:2026-10-18:7', kind: 'streak', count: 7, date: '2026-10-24' },
		]);
	});

	it('marks a day as the best day once a week of days came before it', () => {
		const week: [string, number][] = Array.from({ length: 7 }, (_, index) => [
			shiftDate('2026-10-01', index * 2),
			5,
		]);
		expect(recentMoments(stats([...week, [THROUGH, 9]]))).toEqual([
			{ id: `best-day:${THROUGH}`, kind: 'best-day', count: 9, date: THROUGH },
		]);
		expect(recentMoments(stats([...week.slice(1), [THROUGH, 9]]))).toEqual([]);
		expect(recentMoments(stats([...week, [THROUGH, 5]]))).toEqual([]);
	});

	it('marks the day the runs cross a thousand, counting only the runs up to that day', () => {
		const days: [string, number][] = [
			['2026-10-01', 2],
			[THROUGH, 4],
		];
		expect(recentMoments(stats(days, 1002))).toEqual([
			{ id: 'runs:1000', kind: 'runs', count: 1000, date: THROUGH },
		]);
		expect(recentMoments(stats(days, 1004))).toEqual([]);
		expect(
			recentMoments(
				stats(
					[
						['2026-10-01', 2],
						['2026-10-26', 4],
						[THROUGH, 10],
					],
					1012,
				),
			),
		).toEqual([{ id: 'runs:1000', kind: 'runs', count: 1000, date: '2026-10-26' }]);
	});

	it('keeps every milestone of a day, newest day first', () => {
		const week: [string, number][] = Array.from({ length: 7 }, (_, index) => [
			shiftDate('2026-10-01', index * 2),
			5,
		]);
		expect(recentMoments(stats([...week, ['2026-10-25', 9], [THROUGH, 1]], 1005))).toEqual([
			{ id: 'best-day:2026-10-25', kind: 'best-day', count: 9, date: '2026-10-25' },
			{ id: 'runs:1000', kind: 'runs', count: 1000, date: '2026-10-25' },
		]);
	});

	it('looks back a week and no further', () => {
		expect(recentMoments(stats(streakEnding('2026-10-26', 7)))).toEqual([
			{ id: 'streak:2026-10-20:7', kind: 'streak', count: 7, date: '2026-10-26' },
		]);
		expect(recentMoments(stats(streakEnding('2026-10-22', 7)))).toEqual([]);
		expect(recentMoments(stats([['2026-10-20', 3]], 1000))).toEqual([]);
		expect(recentMoments(stats([]))).toEqual([]);
	});
});

describe('unseenMoment', () => {
	const threeThousand: StatsMoment = {
		id: 'runs:3000',
		kind: 'runs',
		count: 3000,
		date: '2026-10-28',
	};
	const bestDay: StatsMoment = {
		id: 'best-day:2026-10-23',
		kind: 'best-day',
		count: 311,
		date: '2026-10-23',
	};
	const twoThousand: StatsMoment = {
		id: 'runs:2000',
		kind: 'runs',
		count: 2000,
		date: '2026-10-23',
	};
	const moments = [threeThousand, bestDay, twoThousand];

	it('shows the newest milestone you have not dismissed', () => {
		expect(unseenMoment(moments, [])).toBe(threeThousand);
		expect(unseenMoment(moments, ['runs:1000'])).toBe(threeThousand);
		expect(unseenMoment(moments, [bestDay.id])).toBe(threeThousand);
	});

	it('hides every milestone older than one you dismissed, but not one from the same day', () => {
		expect(unseenMoment(moments, [threeThousand.id])).toBeNull();
		expect(unseenMoment([bestDay, twoThousand], [bestDay.id])).toBe(twoThousand);
		expect(unseenMoment([bestDay, twoThousand], [bestDay.id, twoThousand.id])).toBeNull();
	});
});
