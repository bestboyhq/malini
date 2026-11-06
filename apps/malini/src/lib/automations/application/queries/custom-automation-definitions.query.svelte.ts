import type { AutomationDefinitionRecord } from '$contract/automations';
import { automationDefinitionsAggregate } from '$lib/automations/infrastructure/aggregates/automation-definitions.aggregate.svelte';

export { customAutomationDefinitionsQuery };

class CustomAutomationDefinitionsQuery {
	public readonly data: readonly AutomationDefinitionRecord[] = $derived(
		automationDefinitionsAggregate.definitions
			.filter((definition) => definition.builtin === null)
			.sort((left, right) => left.name.localeCompare(right.name)),
	);
}

const customAutomationDefinitionsQuery = new CustomAutomationDefinitionsQuery();
