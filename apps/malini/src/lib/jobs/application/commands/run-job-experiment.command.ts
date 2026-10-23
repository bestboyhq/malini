import type { JobExperimentRecord } from '$contract/jobs';
import { jobExperimentsAggregate } from '$lib/jobs/infrastructure/aggregates/job-experiments.aggregate.svelte';
import { jobsService } from '$lib/jobs/infrastructure/services/jobs.service';
import { jobActionsStore } from '$lib/jobs/infrastructure/stores/job-actions.store.svelte';

export { runJobExperimentCommand };

function runJobExperimentCommand(experiment: JobExperimentRecord, instructions?: string): void {
	if (experiment.running) return;
	void jobActionsStore.run(experiment.id, async () => {
		if (instructions !== undefined && instructions.trim() !== experiment.instructions) {
			jobExperimentsAggregate.apply(
				await jobsService.saveExperiment({
					definitionId: experiment.definitionId,
					experimentId: experiment.id,
					model: experiment.model,
					instructions,
				}),
			);
		}
		jobExperimentsAggregate.apply(await jobsService.runExperiment(experiment.id));
	});
}
