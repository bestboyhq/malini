import type { AutomationExperimentRecord } from '$contract/automations';
import { goto } from '$shared/router/navigation';
import { automationHref } from '$shared/router/routes-hrefs';
import { automationDefinitionsAggregate } from '$lib/automations/infrastructure/aggregates/automation-definitions.aggregate.svelte';
import { automationExperimentsAggregate } from '$lib/automations/infrastructure/aggregates/automation-experiments.aggregate.svelte';
import { automationsService } from '$lib/automations/infrastructure/services/automations.service';
import { automationActionsStore } from '$lib/automations/infrastructure/stores/automation-actions.store.svelte';
import { loadAutomationScorecardCommand } from './load-automation-scorecard.command';

export { useAutomationExperimentCommand };

function useAutomationExperimentCommand(experiment: AutomationExperimentRecord): void {
	void automationActionsStore.run(experiment.id, async () => {
		const definition = await automationsService.useExperiment(experiment.id);
		automationDefinitionsAggregate.upsert(definition);
		automationExperimentsAggregate.close(definition.id);
		loadAutomationScorecardCommand(definition.id);
		await goto(automationHref(definition.id));
	});
}
