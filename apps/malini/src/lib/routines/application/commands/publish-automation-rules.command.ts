import { routinesAggregate } from '$lib/routines/infrastructure/aggregates/routines.aggregate.svelte';
import {
	automationRulesStore,
	workstreamRoutineDefinitions,
} from '$shared/extensions/automation-rules.store.svelte';

export { publishAutomationRulesCommand };

function publishAutomationRulesCommand(): void {
	automationRulesStore.publishDefinitions(workstreamRoutineDefinitions(routinesAggregate.routines));
}
