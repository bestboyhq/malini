import type { JobRunRecord } from '$contract/jobs';
import { isFinishedJobRunStatus } from '$lib/jobs/domain/job-run';
import { jobRunsAggregate } from '$lib/jobs/infrastructure/aggregates/job-runs.aggregate.svelte';

export { recentFinishedJobRunsQuery };

const RECENT_MS = 24 * 60 * 60 * 1_000;
const LIMIT = 10;

class RecentFinishedJobRunsQuery {
	public readonly data: (nowMs: number) => readonly JobRunRecord[] = $derived((nowMs: number) =>
		jobRunsAggregate.runs
			.filter((run) => isFinishedJobRunStatus(run.status) && nowMs - finishedAtMs(run) < RECENT_MS)
			.sort((left, right) => finishedAtMs(right) - finishedAtMs(left))
			.slice(0, LIMIT),
	);
}

function finishedAtMs(run: JobRunRecord): number {
	return Date.parse(run.finishedAt ?? run.createdAt);
}

const recentFinishedJobRunsQuery = new RecentFinishedJobRunsQuery();
