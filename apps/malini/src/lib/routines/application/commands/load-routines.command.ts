import { routinesAggregate } from '$lib/routines/infrastructure/aggregates/routines.aggregate.svelte';
import { publishAutomationRulesCommand } from './publish-automation-rules.command';

export { loadRoutinesCommand };

function loadRoutinesCommand(): void {
	void (async () => {
		await routinesAggregate.load();
		publishAutomationRulesCommand();
	})();
}
