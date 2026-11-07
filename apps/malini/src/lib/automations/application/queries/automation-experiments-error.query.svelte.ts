import { automationExperimentsAggregate } from '$lib/automations/infrastructure/aggregates/automation-experiments.aggregate.svelte';

export { automationExperimentsErrorQuery };

class AutomationExperimentsErrorQuery {
	public readonly data: (definitionId: string) => string | null = $derived(
		(definitionId: string) => automationExperimentsAggregate.loadErrors[definitionId] ?? null,
	);
}

const automationExperimentsErrorQuery = new AutomationExperimentsErrorQuery();
