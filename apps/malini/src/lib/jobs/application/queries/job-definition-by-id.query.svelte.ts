import type { JobDefinitionRecord } from '$contract/jobs';
import { jobDefinitionsAggregate } from '$lib/jobs/infrastructure/aggregates/job-definitions.aggregate.svelte';

export { jobDefinitionByIdQuery };

class JobDefinitionByIdQuery {
	public readonly data: (definitionId: string | null) => JobDefinitionRecord | null = $derived(
		(definitionId: string | null) =>
			jobDefinitionsAggregate.definitions.find((definition) => definition.id === definitionId) ??
			null,
	);
}

const jobDefinitionByIdQuery = new JobDefinitionByIdQuery();
