import type { JobRunRecord, JobRunStatus } from '$contract/jobs';
import { jobRunsAggregate } from '$lib/jobs/infrastructure/aggregates/job-runs.aggregate.svelte';

export { activeJobRunsQuery };

const ACTIVE_RANK: Partial<Readonly<Record<JobRunStatus, number>>> = {
	'needs-you': 0,
	running: 1,
	queued: 2,
};

class ActiveJobRunsQuery {
	public readonly data: readonly JobRunRecord[] = $derived(
		jobRunsAggregate.runs
			.filter((run) => ACTIVE_RANK[run.status] !== undefined)
			.sort(
				(left, right) =>
					(ACTIVE_RANK[left.status] ?? 0) - (ACTIVE_RANK[right.status] ?? 0) ||
					left.createdAt.localeCompare(right.createdAt),
			),
	);
}

const activeJobRunsQuery = new ActiveJobRunsQuery();
