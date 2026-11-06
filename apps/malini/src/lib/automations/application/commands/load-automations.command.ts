import { automationDefinitionsAggregate } from '$lib/automations/infrastructure/aggregates/automation-definitions.aggregate.svelte';
import { automationRunsAggregate } from '$lib/automations/infrastructure/aggregates/automation-runs.aggregate.svelte';
import { automationSuggestionsAggregate } from '$lib/automations/infrastructure/aggregates/automation-suggestions.aggregate.svelte';
import { reconcilerDecisionsAggregate } from '$lib/automations/infrastructure/aggregates/reconciler-decisions.aggregate.svelte';

export { loadAutomationsCommand };

function loadAutomationsCommand(): void {
	void automationDefinitionsAggregate.load();
	void (async () => {
		try {
			await Promise.all([
				automationRunsAggregate.load(),
				reconcilerDecisionsAggregate.load(),
				automationSuggestionsAggregate.load(),
			]);
		} catch (error) {
			console.error('[malini automations] could not load automation runs', error);
		}
	})();
}
