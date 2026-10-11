import type { JobDefinitionRecord } from '$contract/jobs';
import { jobDefinitionsAggregate } from '$lib/jobs/infrastructure/aggregates/job-definitions.aggregate.svelte';

export { customJobDefinitionsQuery };

class CustomJobDefinitionsQuery {
	public readonly data: readonly JobDefinitionRecord[] = $derived(
		jobDefinitionsAggregate.definitions
			.filter((definition) => definition.builtin === null)
			.sort((left, right) => left.name.localeCompare(right.name)),
	);
}

const customJobDefinitionsQuery = new CustomJobDefinitionsQuery();
