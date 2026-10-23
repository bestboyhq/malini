import type { JobExperimentRecord } from '$contract/jobs';
import { goto } from '$shared/router/navigation';
import { jobHref } from '$shared/router/routes-hrefs';
import { jobDefinitionsAggregate } from '$lib/jobs/infrastructure/aggregates/job-definitions.aggregate.svelte';
import { jobExperimentsAggregate } from '$lib/jobs/infrastructure/aggregates/job-experiments.aggregate.svelte';
import { jobsService } from '$lib/jobs/infrastructure/services/jobs.service';
import { jobActionsStore } from '$lib/jobs/infrastructure/stores/job-actions.store.svelte';
import { loadJobScorecardCommand } from './load-job-scorecard.command';

export { useJobExperimentCommand };

function useJobExperimentCommand(experiment: JobExperimentRecord): void {
	void jobActionsStore.run(experiment.id, async () => {
		const definition = await jobsService.useExperiment(experiment.id);
		jobDefinitionsAggregate.upsert(definition);
		jobExperimentsAggregate.close(definition.id);
		loadJobScorecardCommand(definition.id);
		await goto(jobHref(definition.id));
	});
}
