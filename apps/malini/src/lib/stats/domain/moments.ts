import type { PublishedDay, PublishedStats, StatsMoment } from '$contract/stats';
import { shiftDate } from './activity';
import { publishedStreak } from './published-stats';

const STREAK_MILESTONES: ReadonlySet<number> = new Set([7, 30, 100, 365]);
const LONGEST_STREAK_FROM = 7;
const BEST_DAY_AFTER_DAYS = 7;
const RUNS_STEP = 1000;

// ponytail: "longest" and "best" look back over the published year only; read every run if a year falls short.
export function latestMoment(stats: PublishedStats): StatsMoment | null {
	const yesterday = stats.days.at(-1);
	if (!yesterday || yesterday.date !== stats.through) return null;

	const streak = publishedStreak(stats);
	const start = shiftDate(stats.through, 1 - streak);
	const longestBefore = longestStreak(stats.days.filter((day) => day.date < start));
	const beatsLongest = streak === longestBefore + 1 && streak >= LONGEST_STREAK_FROM;
	if (STREAK_MILESTONES.has(streak) || beatsLongest) {
		return { id: `streak:${start}:${streak}`, kind: 'streak', count: streak };
	}

	const earlier = stats.days.slice(0, -1);
	const bestBefore = Math.max(0, ...earlier.map((day) => day.runs));
	if (earlier.length >= BEST_DAY_AFTER_DAYS && yesterday.runs > bestBefore) {
		return { id: `best-day:${stats.through}`, kind: 'best-day', count: yesterday.runs };
	}

	const reached = Math.floor(stats.totals.runs / RUNS_STEP) * RUNS_STEP;
	if (reached > 0 && stats.totals.runs - yesterday.runs < reached) {
		return { id: `runs:${reached}`, kind: 'runs', count: reached };
	}
	return null;
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
