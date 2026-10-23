import type { JobExperimentRecord } from '$contract/jobs';
import { jobExperimentsAggregate } from '$lib/jobs/infrastructure/aggregates/job-experiments.aggregate.svelte';
import { jobsService } from '$lib/jobs/infrastructure/services/jobs.service';
import { jobActionsStore } from '$lib/jobs/infrastructure/stores/job-actions.store.svelte';

export { changeJobExperimentCommand };

function changeJobExperimentCommand(
	experiment: JobExperimentRecord,
	change: Readonly<{ model?: string; instructions?: string }>,
): void {
	const model = change.model ?? experiment.model;
	const instructions = change.instructions ?? experiment.instructions;
	if (model === experiment.model && instructions === experiment.instructions) return;
	void jobActionsStore.run(experiment.id, async () => {
		jobExperimentsAggregate.apply(
			await jobsService.saveExperiment({
				definitionId: experiment.definitionId,
				experimentId: experiment.id,
				model,
				instructions,
			}),
		);
	});
}
