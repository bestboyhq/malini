import { jobActionsStore } from '$lib/jobs/infrastructure/stores/job-actions.store.svelte';
import { jobExperimentsActionId } from '$lib/jobs/infrastructure/stores/job-experiment-selection.store.svelte';

export { newJobExperimentStateQuery };

class NewJobExperimentStateQuery {
	public readonly data: (
		definitionId: string,
	) => Readonly<{ busy: boolean; error: string | null }> = $derived((definitionId: string) => ({
		busy: jobActionsStore.isBusy(jobExperimentsActionId(definitionId)),
		error: jobActionsStore.errorFor(jobExperimentsActionId(definitionId)),
	}));
}

const newJobExperimentStateQuery = new NewJobExperimentStateQuery();
