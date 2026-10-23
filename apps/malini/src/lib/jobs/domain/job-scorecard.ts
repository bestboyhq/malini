import type { AutomaticJobBuiltin, JobOutputRecord, JobSetupRecord } from '$contract/jobs';
import { jobOutputIssues } from './job-output-checks';

export const SCORECARD_DAYS = 14;

const WEEK_DAYS = 7;
const FRESH_SETUP_DAYS = 4;

export type ScorecardDay = Readonly<{ key: string; date: Date; total: number; broke: number }>;

export type ScorecardBand = Readonly<{
	setup: JobSetupRecord;
	start: number;
	end: number;
	rate: number | null;
	changed: boolean;
}>;

export type FlaggedOutput = Readonly<{ output: JobOutputRecord; issues: readonly string[] }>;

export type JobScorecard = Readonly<{
	days: readonly ScorecardDay[];
	slots: number;
	total: number;
	broke: number;
	weekRate: number | null;
	previousWeekRate: number | null;
	flagged: readonly FlaggedOutput[];
	bands: readonly ScorecardBand[];
}>;

export function scorecardSince(now: Date): Date {
	return addDays(startOfDay(now), 1 - SCORECARD_DAYS);
}

export function jobScorecard(
	builtin: AutomaticJobBuiltin,
	outputs: readonly JobOutputRecord[],
	setups: readonly JobSetupRecord[],
	now: Date,
): JobScorecard {
	const first = scorecardSince(now);
	const days = Array.from({ length: SCORECARD_DAYS }, (_, index) => addDays(first, index));
	const keys = days.map(dayKey);
	const judged = outputs
		.filter((output) => keys.includes(dayKey(new Date(output.createdAt))))
		.map((output) => ({ output, issues: jobOutputIssues(builtin, output.output) }));
	const dayOf = (output: JobOutputRecord): number =>
		keys.indexOf(dayKey(new Date(output.createdAt)));
	const inDays = (from: number, to: number): typeof judged =>
		judged.filter(({ output }) => dayOf(output) >= from && dayOf(output) < to);
	const bands = setupBands(setups, keys, judged);
	const latestStart = bands.at(-1)?.start ?? null;
	const age = latestStart === null ? null : SCORECARD_DAYS - 1 - latestStart;
	const future = age === null ? 0 : Math.max(0, FRESH_SETUP_DAYS - age);
	const slots = SCORECARD_DAYS + future;
	return {
		days: days.map((date, index) => {
			const day = inDays(index, index + 1);
			return {
				key: keys[index] ?? '',
				date,
				total: day.length,
				broke: day.filter(({ issues }) => issues.length > 0).length,
			};
		}),
		slots,
		total: judged.length,
		broke: judged.filter(({ issues }) => issues.length > 0).length,
		weekRate: rate(inDays(SCORECARD_DAYS - WEEK_DAYS, SCORECARD_DAYS)),
		previousWeekRate: rate(inDays(0, SCORECARD_DAYS - WEEK_DAYS)),
		flagged: inDays(SCORECARD_DAYS - WEEK_DAYS, SCORECARD_DAYS)
			.filter(({ issues }) => issues.length > 0)
			.sort((left, right) => right.output.createdAt.localeCompare(left.output.createdAt)),
		bands: bands.map((band, index) => ({
			...band,
			end: bands[index + 1]?.start ?? slots,
		})),
	};
}

function setupBands(
	setups: readonly JobSetupRecord[],
	keys: readonly string[],
	judged: readonly FlaggedOutput[],
): ScorecardBand[] {
	const ordered = [...setups].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
	const usedDays = (setup: JobSetupRecord): Set<string> =>
		new Set(
			judged
				.filter(({ output }) => output.setupId === setup.id)
				.map(({ output }) => dayKey(new Date(output.createdAt))),
		);
	const starts = ordered.map((setup, index) => {
		const key = dayKey(new Date(setup.createdAt));
		if (key < (keys[0] ?? '')) return 0;
		const day = keys.indexOf(key);
		const previous = ordered[index - 1];
		return previous && usedDays(previous).has(key) ? day + 1 : day;
	});
	return ordered
		.map((setup, index) => ({
			setup,
			start: starts[index] ?? 0,
			end: starts[index + 1] ?? Number.POSITIVE_INFINITY,
			rate: rate(judged.filter(({ output }) => output.setupId === setup.id)),
			changed: index > 0,
		}))
		.filter((band) => band.start >= 0 && band.end > band.start);
}

function rate(judged: readonly FlaggedOutput[]): number | null {
	if (judged.length === 0) return null;
	return judged.filter(({ issues }) => issues.length === 0).length / judged.length;
}

function startOfDay(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function dayKey(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${date.getFullYear()}-${month}-${day}`;
}
