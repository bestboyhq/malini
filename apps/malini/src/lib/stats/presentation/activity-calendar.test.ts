import { describe, expect, it } from 'vitest';
import { activityCalendar, activityLevel } from './activity-calendar';

describe('activityCalendar', () => {
	it('ends on the week of today, starts weeks on Monday and leaves the rest of this week blank', () => {
		const calendar = activityCalendar(
			[
				{ date: '2026-10-13', runs: 135 },
				{ date: '2026-10-15', runs: 37 },
				{ date: '2026-03-02', runs: 9 },
			],
			'2026-10-15',
			4,
		);

		expect(calendar.weeks).toHaveLength(4);
		expect(calendar.weeks[0]?.[0]?.date).toBe('2026-09-21');
		const thisWeek = calendar.weeks.at(-1) ?? [];
		expect(thisWeek.map((day) => day.date)).toEqual([
			'2026-10-12',
			'2026-10-13',
			'2026-10-14',
			'2026-10-15',
			'2026-10-16',
			'2026-10-17',
			'2026-10-18',
		]);
		expect(thisWeek.map((day) => day.level)).toEqual([0, 4, 0, 2, 0, 0, 0]);
		expect(thisWeek.map((day) => day.future)).toEqual([
			false,
			false,
			false,
			false,
			true,
			true,
			true,
		]);
		expect(calendar.activeDays).toBe(2);
		expect(calendar.months.map((month) => month.week)).toEqual([1]);
	});

	it('grades a day against the busiest day shown', () => {
		expect([0, 1, 25, 26, 50, 51, 75, 76, 100].map((runs) => activityLevel(runs, 100))).toEqual([
			0, 1, 1, 2, 2, 3, 3, 4, 4,
		]);
	});
});
