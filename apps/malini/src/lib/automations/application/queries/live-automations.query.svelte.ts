import { liveAutomations, type LiveAutomation } from '$lib/automations/domain/live-automations';
import { automationRunsAggregate } from '$lib/automations/infrastructure/aggregates/automation-runs.aggregate.svelte';
import { reconcilerDecisionsAggregate } from '$lib/automations/infrastructure/aggregates/reconciler-decisions.aggregate.svelte';

export { liveAutomationsQuery };

class LiveAutomationsQuery {
	public readonly data: readonly LiveAutomation[] = $derived(
		liveAutomations(automationRunsAggregate.runs, reconcilerDecisionsAggregate.decisions),
	);
}

const liveAutomationsQuery = new LiveAutomationsQuery();
