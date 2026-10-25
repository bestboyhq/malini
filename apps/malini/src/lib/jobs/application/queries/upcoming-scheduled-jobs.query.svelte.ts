import { nextScheduleSlot, scheduledJobOf, type ScheduledJob } from '$lib/jobs/domain/schedule';
import { jobDefinitionsAggregate } from '$lib/jobs/infrastructure/aggregates/job-definitions.aggregate.svelte';

export { upcomingScheduledJobsQuery, type UpcomingScheduledJob };

type UpcomingScheduledJob = ScheduledJob & Readonly<{ nextAt: number }>;

class UpcomingScheduledJobsQuery {
	public readonly data: (nowMs: number) => readonly UpcomingScheduledJob[] = $derived(
		(nowMs: number) =>
			jobDefinitionsAggregate.definitions
				.flatMap((definition) => scheduledJobOf(definition) ?? [])
				.map((job) => ({ ...job, nextAt: nextScheduleSlot(job.schedule, nowMs) }))
				.sort((left, right) => left.nextAt - right.nextAt),
	);
}

const upcomingScheduledJobsQuery = new UpcomingScheduledJobsQuery();
