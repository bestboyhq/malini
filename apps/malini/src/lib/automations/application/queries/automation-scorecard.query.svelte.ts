import { isOneShotAutomationBuiltin, type AutomationDefinitionRecord } from '$contract/automations';
import {
	automationScorecard,
	type AutomationScorecard,
} from '$lib/automations/domain/automation-scorecard';
import { automationScorecardsAggregate } from '$lib/automations/infrastructure/aggregates/automation-scorecards.aggregate.svelte';

export { automationScorecardQuery };

class AutomationScorecardQuery {
	public readonly data: (
		definition: AutomationDefinitionRecord,
		nowMs: number,
	) => AutomationScorecard | null = $derived(
		(definition: AutomationDefinitionRecord, nowMs: number) => {
			const entities = automationScorecardsAggregate.entities[definition.id];
			if (!entities || !isOneShotAutomationBuiltin(definition.builtin)) return null;
			return automationScorecard(
				definition.builtin,
				entities.outputs,
				entities.setups,
				new Date(nowMs),
			);
		},
	);
}

const automationScorecardQuery = new AutomationScorecardQuery();
