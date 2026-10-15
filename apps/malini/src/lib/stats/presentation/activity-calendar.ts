import type { ActivityDay } from '$contract/stats';
import { shiftDate } from '$lib/stats/domain/activity';

export type ActivityLevel = 0 | 1 | 2 | 3 | 4;

export type CalendarDay = Readonly<{
	date: string;
	runs: number;
	level: ActivityLevel;
	future: boolean;
}>;

export type CalendarMonth = Readonly<{ label: string; week: number }>;

export type ActivityCalendar = Readonly<{
	weeks: readonly (readonly CalendarDay[])[];
	months: readonly CalendarMonth[];
	activeDays: number;
}>;

const MIN_WEEKS_BETWEEN_MONTHS = 3;
const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' });

export function activityCalendar(
	days: readonly ActivityDay[],
	today: string,
	weekCount: number,
): ActivityCalendar {
	const runsByDate = new Map(days.map((day) => [day.date, day.runs]));
	const start = shiftDate(today, -(weekdayIndex(today) + 7 * (weekCount - 1)));
	const dates = Array.from({ length: weekCount * 7 }, (_, index) => shiftDate(start, index));
	const past = dates.filter((date) => date <= today);
	const busiest = Math.max(0, ...past.map((date) => runsByDate.get(date) ?? 0));
	const cells = dates.map((date): CalendarDay => {
		const runs = date <= today ? (runsByDate.get(date) ?? 0) : 0;
		return { date, runs, level: activityLevel(runs, busiest), future: date > today };
	});
	const weeks = Array.from({ length: weekCount }, (_, week) => cells.slice(week * 7, week * 7 + 7));
	return {
		weeks,
		months: monthLabels(weeks),
		activeDays: past.filter((date) => (runsByDate.get(date) ?? 0) > 0).length,
	};
}

export function activityLevel(runs: number, busiest: number): ActivityLevel {
	if (runs <= 0 || busiest <= 0) return 0;
	const level = Math.ceil((runs / busiest) * 4);
	if (level >= 4) return 4;
	if (level === 3) return 3;
	if (level === 2) return 2;
	return 1;
}

function monthLabels(weeks: readonly (readonly CalendarDay[])[]): CalendarMonth[] {
	const months: CalendarMonth[] = [];
	weeks.forEach((week, index) => {
		const firstOfMonth = week.find((day) => day.date.endsWith('-01'));
		if (!firstOfMonth) return;
		const previous = months.at(-1);
		if (previous && index - previous.week < MIN_WEEKS_BETWEEN_MONTHS) return;
		months.push({
			label: monthFormat.format(new Date(`${firstOfMonth.date}T00:00:00Z`)),
			week: index,
		});
	});
	return months;
}

function weekdayIndex(date: string): number {
	return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}
