import { describe, expect, it } from 'vitest';
import type { PublishedStats } from '$contract/stats';
import { shiftDate } from './activity';
import { latestMoment } from './moments';

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

function streakEndingYesterday(length: number, runs = 2): [string, number][] {
	return Array.from({ length }, (_, index) => [shiftDate(THROUGH, index + 1 - length), runs]);
}

describe('latestMoment', () => {
	it('marks a streak milestone whether or not an earlier streak was longer', () => {
		expect(latestMoment(stats(streakEndingYesterday(7)))).toEqual({
			id: 'streak:2026-10-23:7',
			kind: 'streak',
			count: 7,
		});
		const earlierLongStreak: [string, number][] = Array.from({ length: 9 }, (_, index) => [
			shiftDate('2026-09-01', index),
			2,
		]);
		expect(latestMoment(stats([...earlierLongStreak, ...streakEndingYesterday(7)]))).toMatchObject({
			kind: 'streak',
			count: 7,
		});
	});

	it('marks the first day a streak beats the longest one before it, and stays quiet after', () => {
		const earlier: [string, number][] = Array.from({ length: 10 }, (_, index) => [
			shiftDate('2026-08-01', index),
			2,
		]);
		expect(latestMoment(stats([...earlier, ...streakEndingYesterday(11)]))).toEqual({
			id: 'streak:2026-10-19:11',
			kind: 'streak',
			count: 11,
		});
		expect(latestMoment(stats([...earlier, ...streakEndingYesterday(12)]))).toBeNull();
	});

	it('marks yesterday as the best day once a week of days came before it', () => {
		const week: [string, number][] = Array.from({ length: 7 }, (_, index) => [
			shiftDate('2026-10-01', index * 2),
			5,
		]);
		expect(latestMoment(stats([...week, [THROUGH, 9]]))).toEqual({
			id: `best-day:${THROUGH}`,
			kind: 'best-day',
			count: 9,
		});
		expect(latestMoment(stats([...week.slice(1), [THROUGH, 9]]))).toBeNull();
		expect(latestMoment(stats([...week, [THROUGH, 5]]))).toBeNull();
	});

	it('marks the day the runs cross a thousand', () => {
		const days: [string, number][] = [
			['2026-10-01', 2],
			[THROUGH, 4],
		];
		expect(latestMoment(stats(days, 1002))).toEqual({
			id: 'runs:1000',
			kind: 'runs',
			count: 1000,
		});
		expect(latestMoment(stats(days, 1004))).toBeNull();
	});

	it('stays quiet when nothing ran yesterday', () => {
		expect(latestMoment(stats([['2026-10-27', 3]], 1000))).toBeNull();
		expect(latestMoment(stats([]))).toBeNull();
	});
});
