import type { ActivityDay, ActivityStats } from '$contract/stats';

export type RepositoryDayActivity = Readonly<{
	date: string;
	fullName: string;
	runs: number;
	jobRuns: number;
	seconds: number;
}>;

export function summarizeActivity(
	activity: readonly RepositoryDayActivity[],
	today: string,
	runningAgents: number,
): ActivityStats {
	const days = new Map<string, number>();
	const repositories = new Map<string, number>();
	for (const entry of activity) {
		days.set(entry.date, (days.get(entry.date) ?? 0) + entry.runs);
		repositories.set(entry.fullName, (repositories.get(entry.fullName) ?? 0) + entry.runs);
	}
	return {
		today,
		runs: sum(activity, (entry) => entry.runs),
		jobRuns: sum(activity, (entry) => entry.jobRuns),
		agentSeconds: Math.round(sum(activity, (entry) => entry.seconds)),
		runningAgents,
		days: [...days]
			.map(([date, runs]) => ({ date, runs }))
			.sort((left, right) => left.date.localeCompare(right.date)),
		repositories: [...repositories]
			.map(([fullName, runs]) => ({ fullName, runs }))
			.sort((left, right) => right.runs - left.runs || left.fullName.localeCompare(right.fullName)),
	};
}

export function runsOn(days: readonly ActivityDay[], date: string): number {
	return days.find((day) => day.date === date)?.runs ?? 0;
}

export function dayStreak(days: readonly ActivityDay[], today: string): number {
	const active = new Set(days.filter((day) => day.runs > 0).map((day) => day.date));
	let date = active.has(today) ? today : shiftDate(today, -1);
	let streak = 0;
	while (active.has(date)) {
		streak += 1;
		date = shiftDate(date, -1);
	}
	return streak;
}

export function shiftDate(date: string, days: number): string {
	const at = new Date(`${date}T00:00:00Z`);
	at.setUTCDate(at.getUTCDate() + days);
	return at.toISOString().slice(0, 10);
}

export function localDate(at: Date): string {
	const month = String(at.getMonth() + 1).padStart(2, '0');
	const day = String(at.getDate()).padStart(2, '0');
	return `${at.getFullYear()}-${month}-${day}`;
}

function sum<Entry>(entries: readonly Entry[], value: (entry: Entry) => number): number {
	return entries.reduce((total, entry) => total + value(entry), 0);
}
