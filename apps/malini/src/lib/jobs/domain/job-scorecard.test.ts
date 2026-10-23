import { describe, expect, it } from 'vitest';
import type { JobOutputRecord, JobSetupRecord } from '$contract/jobs';
import { jobScorecard, SCORECARD_DAYS } from './job-scorecard';

const NOW = new Date(2026, 9, 23, 15, 0);

function at(daysAgo: number, hour = 12): string {
	return new Date(2026, 9, 23 - daysAgo, hour).toISOString();
}

function setup(id: string, daysAgo: number, expectedRate: number | null = null): JobSetupRecord {
	return { id, model: 'haiku', instructions: id, expectedRate, createdAt: at(daysAgo, 1) };
}

function output(setupId: string, daysAgo: number, name: string): JobOutputRecord {
	return {
		id: `${setupId}-${daysAgo}-${name}`,
		setupId,
		excerpt: 'task',
		output: name,
		error: null,
		createdAt: at(daysAgo),
	};
}

describe('jobScorecard', () => {
	it('counts names per day, rates each week and each setup, and makes room after a fresh change', () => {
		const card = jobScorecard(
			'name-chats',
			[
				output('old', 20, 'Too old to count'),
				output('old', 9, 'Jobs page scrolling'),
				output('old', 9, 'Investigating failed bestboy deployment'),
				output('old', 3, 'Linkify links'),
				output('new', 1, 'Deploy failure'),
				output('new', 0, 'Choosing incorporation jurisdiction'),
			],
			[setup('old', 30), setup('new', 1, 0.85)],
			NOW,
		);

		expect(card.days).toHaveLength(SCORECARD_DAYS);
		expect(card.days.map(({ total }) => total).reduce((sum, total) => sum + total, 0)).toBe(5);
		expect(card.days[SCORECARD_DAYS - 10]).toMatchObject({ total: 2, broke: 1 });
		expect(card.total).toBe(5);
		expect(card.broke).toBe(2);
		expect(card.weekRate).toBe(2 / 3);
		expect(card.previousWeekRate).toBe(1 / 2);
		expect(card.flagged.map(({ output: flagged }) => flagged.output)).toEqual([
			'Choosing incorporation jurisdiction',
		]);
		expect(card.slots).toBe(SCORECARD_DAYS + 3);
		expect(
			card.bands.map(({ setup: { id }, start, end, rate, changed }) => [
				id,
				start,
				end,
				rate,
				changed,
			]),
		).toEqual([
			['old', 0, SCORECARD_DAYS - 2, 2 / 3, false],
			['new', SCORECARD_DAYS - 2, SCORECARD_DAYS + 3, 1 / 2, true],
		]);
	});

	it('starts a setup changed on a day the old one already named things on the next slot', () => {
		const old = { ...setup('old', 0), createdAt: new Date(2026, 9, 23, 9).toISOString() };
		const fresh = { ...setup('new', 0, 1), createdAt: new Date(2026, 9, 23, 14).toISOString() };
		const card = jobScorecard(
			'name-chats',
			[{ ...output('old', 0, 'Investigating failed deploy'), createdAt: old.createdAt }],
			[old, fresh],
			NOW,
		);

		expect(card.slots).toBe(SCORECARD_DAYS + 5);
		expect(card.bands.map(({ setup: { id }, start, end }) => [id, start, end])).toEqual([
			['old', SCORECARD_DAYS - 1, SCORECARD_DAYS],
			['new', SCORECARD_DAYS, SCORECARD_DAYS + 5],
		]);
	});
});
