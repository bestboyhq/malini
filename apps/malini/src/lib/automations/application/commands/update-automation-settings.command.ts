import type {
	AutomationBoundary,
	AutomationDefinitionRecord,
	AutomationRunsIn,
	AutomationTrigger,
} from '$contract/automations';
import { automationDefinitionsAggregate } from '$lib/automations/infrastructure/aggregates/automation-definitions.aggregate.svelte';
import { automationsService } from '$lib/automations/infrastructure/services/automations.service';
import {
	automationActionsStore,
	automationSettingsActionId,
} from '$lib/automations/infrastructure/stores/automation-actions.store.svelte';

export { updateAutomationSettingsCommand };

type AutomationSettingsChange = Readonly<{
	trigger?: AutomationTrigger | null;
	thenAutomationId?: string | null;
	runsIn?: AutomationRunsIn;
	boundary?: AutomationBoundary;
}>;

function updateAutomationSettingsCommand(
	automation: AutomationDefinitionRecord,
	change: AutomationSettingsChange,
): void {
	void automationActionsStore.run(automationSettingsActionId(automation.id), async () => {
		automationDefinitionsAggregate.upsert(
			await automationsService.saveDefinition({
				id: automation.id,
				name: automation.name,
				instructions: automation.instructions,
				provider: automation.provider,
				model: automation.model,
				effort: automation.effort,
				runsIn: automation.runsIn,
				skills: automation.skills,
				...change,
			}),
		);
	});
}
