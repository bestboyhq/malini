import { isFinishedJobRunStatus } from '$lib/jobs/domain/job-run';
import { jobDefinitionsAggregate } from '$lib/jobs/infrastructure/aggregates/job-definitions.aggregate.svelte';
import { jobRunsAggregate } from '$lib/jobs/infrastructure/aggregates/job-runs.aggregate.svelte';

export { shippingJobRunsQuery };

class ShippingJobRunsQuery {
	public readonly workstreamIds: ReadonlySet<string> = $derived.by(() => {
		const shipping = new Set(
			jobDefinitionsAggregate.definitions
				.filter(({ builtin }) => builtin === 'open-draft' || builtin === 'merge')
				.map(({ id }) => id),
		);
		return new Set(
			jobRunsAggregate.runs.flatMap((run) =>
				run.workstreamId !== null &&
				shipping.has(run.definitionId) &&
				!isFinishedJobRunStatus(run.status)
					? [run.workstreamId]
					: [],
			),
		);
	});
}

const shippingJobRunsQuery = new ShippingJobRunsQuery();
