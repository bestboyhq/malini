import { scorecardSince } from '$lib/automations/domain/automation-scorecard';
import { automationScorecardsAggregate } from '$lib/automations/infrastructure/aggregates/automation-scorecards.aggregate.svelte';

export { loadAutomationScorecardCommand };

function loadAutomationScorecardCommand(definitionId: string): void {
	void automationScorecardsAggregate.load(definitionId, scorecardSince(new Date()).toISOString());
}
