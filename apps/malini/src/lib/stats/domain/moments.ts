import type { PublishedDay, PublishedStats, RecentMoments, StatsMoment } from '$contract/stats';
import { dayStreak, shiftDate } from './activity';

const RECENT_DAYS = 7;
const QUIET_DAYS = 7;
const STREAK_MILESTONES: ReadonlySet<number> = new Set([7, 30, 100, 365]);
const LONGEST_STREAK_FROM = 7;
const BEST_DAY_AFTER_DAYS = 7;
const RUNS_STEP = 1000;

// ponytail: "longest" and "best" look back over the published year only; read every run if a year falls short.
export function recentMoments(stats: PublishedStats): StatsMoment[] {
	const since = shiftDate(stats.through, 1 - RECENT_DAYS);
	const moments: StatsMoment[] = [];
	let runsThrough = stats.totals.runs;
	for (let index = stats.days.length - 1; index >= 0; index -= 1) {
		const day = stats.days[index];
		if (!day || day.date < since) break;
		moments.push(...momentsOn(day, stats.days.slice(0, index), runsThrough));
		runsThrough -= day.runs;
	}
	return moments;
}

export function unseenMoment(
	{ moments, through }: RecentMoments,
	dismissedOn: string | null,
): StatsMoment | null {
	if (dismissedOn === null) return moments[0] ?? null;
	if (shiftDate(through, 1) < shiftDate(dismissedOn, QUIET_DAYS)) return null;
	return moments.find((moment) => moment.date >= dismissedOn) ?? null;
}

function momentsOn(
	day: PublishedDay,
	earlier: readonly PublishedDay[],
	runsThrough: number,
): StatsMoment[] {
	const moments: StatsMoment[] = [];
	const streak = dayStreak([...earlier, day], shiftDate(day.date, 1));
	const start = shiftDate(day.date, 1 - streak);
	const longestBefore = longestStreak(earlier.filter((before) => before.date < start));
	const beatsLongest = streak === longestBefore + 1 && streak >= LONGEST_STREAK_FROM;
	if (STREAK_MILESTONES.has(streak) || beatsLongest) {
		moments.push({
			id: `streak:${start}:${streak}`,
			kind: 'streak',
			count: streak,
			date: day.date,
		});
	}

	const bestBefore = Math.max(0, ...earlier.map((before) => before.runs));
	if (earlier.length >= BEST_DAY_AFTER_DAYS && day.runs > bestBefore) {
		moments.push({ id: `best-day:${day.date}`, kind: 'best-day', count: day.runs, date: day.date });
	}

	const reached = Math.floor(runsThrough / RUNS_STEP) * RUNS_STEP;
	if (reached > 0 && runsThrough - day.runs < reached) {
		moments.push({ id: `runs:${reached}`, kind: 'runs', count: reached, date: day.date });
	}
	return moments;
}

function longestStreak(days: readonly PublishedDay[]): number {
	let longest = 0;
	let current = 0;
	let previous: string | null = null;
	for (const { date } of days) {
		current = previous !== null && shiftDate(previous, 1) === date ? current + 1 : 1;
		longest = Math.max(longest, current);
		previous = date;
	}
	return longest;
}
