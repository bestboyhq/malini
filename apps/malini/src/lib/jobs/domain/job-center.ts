import type { JobRunRecord, JobRunStatus, ReconcilerDecisionRecord } from '$contract/jobs';

export type JobCenterEntry = Readonly<{
	key: string;
	run: JobRunRecord | null;
	question: ReconcilerDecisionRecord | null;
	workstreamId: string | null;
}>;

export type JobCenterCounts = Readonly<{ running: number; queued: number; needsYou: number }>;

const LIVE_RANK: Partial<Readonly<Record<JobRunStatus, number>>> = {
	waiting: 0,
	'needs-you': 0,
	running: 1,
	queued: 2,
};

export function jobCenterEntries(
	runs: readonly JobRunRecord[],
	decisions: readonly ReconcilerDecisionRecord[],
): JobCenterEntry[] {
	const byId = new Map(runs.map((run) => [run.id, run]));
	const asking = decisions.filter((decision) => decision.status === 'asking');
	const askedAbout = new Set(asking.map((decision) => decision.subjectRunId));
	const questions = asking.map((question) => {
		const run = question.subjectRunId === null ? null : (byId.get(question.subjectRunId) ?? null);
		return {
			entry: { key: question.id, run, question, workstreamId: question.workstreamId },
			rank: 0,
			at: question.createdAt,
		};
	});
	const live = runs.flatMap((run) => {
		const rank = LIVE_RANK[run.status];
		return rank === undefined || askedAbout.has(run.id)
			? []
			: [
					{
						entry: { key: run.id, run, question: null, workstreamId: run.workstreamId },
						rank,
						at: run.createdAt,
					},
				];
	});
	return [...questions, ...live]
		.sort((left, right) => left.rank - right.rank || left.at.localeCompare(right.at))
		.map(({ entry }) => entry);
}

export function asksYou(entry: JobCenterEntry): boolean {
	return (
		entry.question !== null || entry.run?.status === 'waiting' || entry.run?.status === 'needs-you'
	);
}

export function jobCenterCounts(entries: readonly JobCenterEntry[]): JobCenterCounts {
	const count = (matches: (entry: JobCenterEntry) => boolean): number =>
		entries.filter(matches).length;
	return {
		running: count((entry) => !asksYou(entry) && entry.run?.status === 'running'),
		queued: count((entry) => !asksYou(entry) && entry.run?.status === 'queued'),
		needsYou: count(asksYou),
	};
}
