import type { JobDefinitionRecord } from '$contract/jobs';
import { BUILTIN_JOB_KEYS } from '$lib/jobs/domain/builtin-jobs';
import { jobDefinitionsAggregate } from '$lib/jobs/infrastructure/aggregates/job-definitions.aggregate.svelte';

export { builtinJobDefinitionsQuery };

class BuiltinJobDefinitionsQuery {
	public readonly data: readonly JobDefinitionRecord[] = $derived(
		jobDefinitionsAggregate.definitions
			.filter((definition) => definition.builtin !== null)
			.sort((left, right) => builtinRank(left) - builtinRank(right)),
	);
}

function builtinRank(definition: JobDefinitionRecord): number {
	return definition.builtin === null ? -1 : BUILTIN_JOB_KEYS.indexOf(definition.builtin);
}

const builtinJobDefinitionsQuery = new BuiltinJobDefinitionsQuery();
