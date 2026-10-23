import type { JobExperimentRecord } from '$contract/jobs';
import { jobExperimentsAggregate } from '$lib/jobs/infrastructure/aggregates/job-experiments.aggregate.svelte';
import { jobsService } from '$lib/jobs/infrastructure/services/jobs.service';
import { jobActionsStore } from '$lib/jobs/infrastructure/stores/job-actions.store.svelte';

export { deleteJobExperimentCommand };

function deleteJobExperimentCommand(experiment: JobExperimentRecord): void {
	void jobActionsStore.run(experiment.id, async () => {
		await jobsService.deleteExperiment(experiment.id);
		jobExperimentsAggregate.remove(experiment.definitionId, experiment.id);
	});
}
