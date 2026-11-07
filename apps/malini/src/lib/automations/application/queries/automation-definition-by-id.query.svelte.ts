import type { AutomationDefinitionRecord } from '$contract/automations';
import { automationDefinitionsAggregate } from '$lib/automations/infrastructure/aggregates/automation-definitions.aggregate.svelte';

export { automationDefinitionByIdQuery };

class AutomationDefinitionByIdQuery {
	public readonly data: (definitionId: string | null) => AutomationDefinitionRecord | null =
		$derived(
			(definitionId: string | null) =>
				automationDefinitionsAggregate.definitions.find(
					(definition) => definition.id === definitionId,
				) ?? null,
		);
}

const automationDefinitionByIdQuery = new AutomationDefinitionByIdQuery();
