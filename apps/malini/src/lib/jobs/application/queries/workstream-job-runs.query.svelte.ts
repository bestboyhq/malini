import type { JobRunRecord } from '$contract/jobs';
import { isFinishedJobRunStatus } from '$lib/jobs/domain/job-run';
import { jobRunsAggregate } from '$lib/jobs/infrastructure/aggregates/job-runs.aggregate.svelte';

export { workstreamJobRunsQuery };

const RECENT_MS = 10 * 60 * 1_000;

class WorkstreamJobRunsQuery {
	public readonly data: (workstreamId: string, nowMs: number) => readonly JobRunRecord[] = $derived(
		(workstreamId: string, nowMs: number) =>
			jobRunsAggregate.runs
				.filter(
					(run) =>
						run.workstreamId === workstreamId &&
						isFinishedJobRunStatus(run.status) &&
						nowMs - Date.parse(run.finishedAt ?? run.createdAt) < RECENT_MS,
				)
				.sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
	);
}

const workstreamJobRunsQuery = new WorkstreamJobRunsQuery();
