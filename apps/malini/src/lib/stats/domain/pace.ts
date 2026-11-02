import type { ActivityDay } from '$contract/stats';
import { shiftDate } from './activity';

export type Pace = 'crushing' | 'warming-up';

export type WeekPace = Readonly<{ pace: Pace; runs: number }>;

const WEEK = 7;
const USUAL_WEEKS = 4;
const STEADY_SHARE = 0.75;

export function weekPace(days: readonly ActivityDay[], today: string): WeekPace {
	const weekStart = shiftDate(today, 1 - WEEK);
	const runs = runsBetween(days, weekStart, today);
	const usual =
		runsBetween(days, shiftDate(weekStart, -WEEK * USUAL_WEEKS), shiftDate(weekStart, -1)) /
		USUAL_WEEKS;
	return { pace: runs > 0 && runs >= usual * STEADY_SHARE ? 'crushing' : 'warming-up', runs };
}

function runsBetween(days: readonly ActivityDay[], from: string, through: string): number {
	return days.reduce(
		(total, day) => (day.date >= from && day.date <= through ? total + day.runs : total),
		0,
	);
}
