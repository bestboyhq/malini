import { automationScorecardsAggregate } from '$lib/automations/infrastructure/aggregates/automation-scorecards.aggregate.svelte';

export { automationScorecardErrorQuery };

class AutomationScorecardErrorQuery {
	public readonly data: (definitionId: string) => string | null = $derived(
		(definitionId: string) => automationScorecardsAggregate.loadErrors[definitionId] ?? null,
	);
}

const automationScorecardErrorQuery = new AutomationScorecardErrorQuery();
