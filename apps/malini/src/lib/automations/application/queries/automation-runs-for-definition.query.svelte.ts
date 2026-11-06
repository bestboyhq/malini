import type { AutomationRunRecord } from '$contract/automations';
import { automationRunLastActivityAt } from '$lib/automations/domain/automation-run';
import { automationRunsAggregate } from '$lib/automations/infrastructure/aggregates/automation-runs.aggregate.svelte';

export { automationRunsForDefinitionQuery };

class AutomationRunsForDefinitionQuery {
	public readonly data: (definitionId: string) => readonly AutomationRunRecord[] = $derived(
		(definitionId: string) =>
			automationRunsAggregate.runs
				.filter((run) => run.definitionId === definitionId)
				.sort((left, right) =>
					automationRunLastActivityAt(right).localeCompare(automationRunLastActivityAt(left)),
				),
	);
}

const automationRunsForDefinitionQuery = new AutomationRunsForDefinitionQuery();
