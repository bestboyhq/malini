import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import { jobDefinitionsAggregate } from '$lib/jobs/infrastructure/aggregates/job-definitions.aggregate.svelte';
import { jobRunsAggregate } from '$lib/jobs/infrastructure/aggregates/job-runs.aggregate.svelte';
import { jobsService } from '$lib/jobs/infrastructure/services/jobs.service';
import { jobActionsStore } from '$lib/jobs/infrastructure/stores/job-actions.store.svelte';

export { runShippingJobCommand };

function runShippingJobCommand(
	builtin: 'open-draft' | 'merge',
	workstreamIds: readonly string[],
	chatSessionId: string | null,
): void {
	const job = jobDefinitionsAggregate.definitions.find(
		(definition) => definition.builtin === builtin,
	);
	if (!job) return;
	void jobActionsStore.run(job.id, async () => {
		await Promise.all(
			workstreamIds.map(async (workstreamId) => {
				try {
					jobRunsAggregate.apply(
						await jobsService.run({
							definitionId: job.id,
							workstreamId,
							origin: 'manual',
							...(chatSessionId === null ? {} : { chatSessionId }),
						}),
					);
				} catch (error) {
					toast.error(
						`Could not run ${job.name} · ${error instanceof Error ? error.message : String(error)}`,
						aboutWorkstream(workstreamId),
					);
				}
			}),
		);
	});
}
