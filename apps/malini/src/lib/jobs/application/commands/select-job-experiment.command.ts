import type { JobExperimentRecord } from '$contract/jobs';
import { jobExperimentSelectionStore } from '$lib/jobs/infrastructure/stores/job-experiment-selection.store.svelte';

export { selectJobExperimentCommand };

function selectJobExperimentCommand(experiment: JobExperimentRecord): void {
	jobExperimentSelectionStore.select(experiment.definitionId, experiment.id);
}
