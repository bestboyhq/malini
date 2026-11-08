import {
	defaultsTriggerChanges,
	liveDefaults,
	type AutomationDefaults,
} from '$lib/app/domain/automation-defaults';
import { updateAutomationSettingsCommand } from '$lib/automations/application/commands/update-automation-settings.command';
import { builtinAutomationDefinitionsQuery } from '$lib/automations/application/queries/builtin-automation-definitions.query.svelte';
import { setUpBrainCommand } from '$lib/brain/application/commands/set-up-brain.command';

export function applyAutomationDefaultsCommand(defaults: AutomationDefaults): void {
	const definitions = builtinAutomationDefinitionsQuery.data;
	for (const { definition, trigger } of defaultsTriggerChanges(definitions, defaults)) {
		updateAutomationSettingsCommand(definition, { trigger });
	}
	if (defaults.brain && !liveDefaults(definitions).brain) setUpBrainCommand(true);
}
