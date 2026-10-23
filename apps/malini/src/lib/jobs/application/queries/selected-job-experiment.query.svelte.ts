import type { JobExperimentRecord } from '$contract/jobs';
import { jobExperimentsAggregate } from '$lib/jobs/infrastructure/aggregates/job-experiments.aggregate.svelte';
import { jobExperimentSelectionStore } from '$lib/jobs/infrastructure/stores/job-experiment-selection.store.svelte';

export { selectedJobExperimentQuery };

class SelectedJobExperimentQuery {
	public readonly data: (definitionId: string) => JobExperimentRecord | null = $derived(
		(definitionId: string) => {
			const experiments = jobExperimentsAggregate.sessions[definitionId]?.experiments ?? [];
			const selected = jobExperimentSelectionStore.selected[definitionId];
			return (
				experiments.find((experiment) => experiment.id === selected) ?? experiments.at(-1) ?? null
			);
		},
	);
}

const selectedJobExperimentQuery = new SelectedJobExperimentQuery();
