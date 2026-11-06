import type { AutomationExperimentsRecord } from '$contract/automations';
import { automationExperimentsAggregate } from '$lib/automations/infrastructure/aggregates/automation-experiments.aggregate.svelte';

export { automationExperimentsQuery };

class AutomationExperimentsQuery {
	public readonly data: (definitionId: string) => AutomationExperimentsRecord | null = $derived(
		(definitionId: string) => automationExperimentsAggregate.sessions[definitionId] ?? null,
	);
}

const automationExperimentsQuery = new AutomationExperimentsQuery();
