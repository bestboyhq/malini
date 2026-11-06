import type { AutomationRunRecord } from '$contract/automations';
import { automationRunsAggregate } from '$lib/automations/infrastructure/aggregates/automation-runs.aggregate.svelte';

export { automationRunByIdQuery };

class AutomationRunByIdQuery {
	public readonly data: (automationRunId: string | null) => AutomationRunRecord | null = $derived(
		(automationRunId: string | null) =>
			automationRunsAggregate.runs.find((run) => run.id === automationRunId) ?? null,
	);
}

const automationRunByIdQuery = new AutomationRunByIdQuery();
