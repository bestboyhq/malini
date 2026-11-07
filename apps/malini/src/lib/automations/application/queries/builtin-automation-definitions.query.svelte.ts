import type { AutomationDefinitionRecord } from '$contract/automations';
import { BUILTIN_AUTOMATION_KEYS } from '$lib/automations/domain/builtin-automations';
import { automationDefinitionsAggregate } from '$lib/automations/infrastructure/aggregates/automation-definitions.aggregate.svelte';

export { builtinAutomationDefinitionsQuery };

class BuiltinAutomationDefinitionsQuery {
	public readonly data: readonly AutomationDefinitionRecord[] = $derived(
		automationDefinitionsAggregate.definitions
			.filter((definition) => definition.builtin !== null)
			.sort((left, right) => builtinRank(left) - builtinRank(right)),
	);
}

function builtinRank(definition: AutomationDefinitionRecord): number {
	return definition.builtin === null ? -1 : BUILTIN_AUTOMATION_KEYS.indexOf(definition.builtin);
}

const builtinAutomationDefinitionsQuery = new BuiltinAutomationDefinitionsQuery();
