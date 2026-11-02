import type { JobExperimentRecord } from '$contract/jobs';
import { jobExperimentsAggregate } from '$lib/jobs/infrastructure/aggregates/job-experiments.aggregate.svelte';
import { jobsService } from '$lib/jobs/infrastructure/services/jobs.service';
import { jobActionsStore } from '$lib/jobs/infrastructure/stores/job-actions.store.svelte';
import {
	jobExperimentSelectionStore,
	jobExperimentsActionId,
} from '$lib/jobs/infrastructure/stores/job-experiment-selection.store.svelte';

export { addJobExperimentCommand };

function addJobExperimentCommand(from: JobExperimentRecord): void {
	void jobActionsStore.run(jobExperimentsActionId(from.definitionId), async () => {
		const experiment = await jobsService.saveExperiment({
			definitionId: from.definitionId,
			provider: from.provider,
			model: from.model,
			instructions: from.instructions,
		});
		jobExperimentsAggregate.apply(experiment);
		jobExperimentSelectionStore.select(experiment.definitionId, experiment.id);
	});
}
