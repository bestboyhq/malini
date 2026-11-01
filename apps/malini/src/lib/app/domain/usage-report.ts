import type { UsageReport, UsageReportAge } from '$contract/system';
import { localDate, shiftDate } from '$lib/stats/domain/activity';

export type ReportedWorkstream = Readonly<{
	id: string;
	createdAt: string;
	archivedAt: string | null;
	merged: boolean;
}>;

export type ReportedPrompt = Readonly<{ workstreamId: string; startedAt: string }>;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export function reportDay(now: Date): string {
	return shiftDate(localDate(now), -1);
}

export function usageReport(
	now: Date,
	workstreams: readonly ReportedWorkstream[],
	prompts: readonly ReportedPrompt[],
): UsageReport | null {
	const day = reportDay(now);
	const on = (at: string | null): boolean => at !== null && localDate(new Date(at)) === day;
	const merged = workstreams.flatMap((workstream) =>
		workstream.merged && workstream.archivedAt !== null && on(workstream.archivedAt)
			? [
					{
						id: workstream.id,
						ms: Date.parse(workstream.archivedAt) - Date.parse(workstream.createdAt),
					},
				]
			: [],
	);
	const started = workstreams.filter((workstream) => on(workstream.createdAt)).length;
	const prompted = prompts.filter((prompt) => on(prompt.startedAt)).length;
	const archived = workstreams.filter(
		(workstream) => !workstream.merged && on(workstream.archivedAt),
	).length;
	const first = workstreams.map((workstream) => workstream.createdAt).sort()[0];
	if (first === undefined || started + prompted + merged.length + archived === 0) return null;
	return {
		day,
		started,
		prompts: prompted,
		merged: merged.length,
		archived,
		turns: median(
			merged.map(({ id }) => prompts.filter((prompt) => prompt.workstreamId === id).length),
		),
		minutes: median(merged.map(({ ms }) => ms / MINUTE_MS)),
		age: reportAge(Date.parse(day) - Date.parse(localDate(new Date(first)))),
	};
}

function median(values: readonly number[]): number | null {
	const sorted = [...values].sort((left, right) => left - right);
	const lower = sorted[Math.ceil(sorted.length / 2) - 1];
	const upper = sorted[Math.floor(sorted.length / 2)];
	return lower === undefined || upper === undefined ? null : Math.round((lower + upper) / 2);
}

function reportAge(ms: number): UsageReportAge {
	const days = Math.round(ms / DAY_MS);
	if (days < 1) return 'day_1';
	if (days < 7) return 'week_1';
	if (days < 30) return 'month_1';
	return 'later';
}
