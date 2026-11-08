import {
	defaultsChoice,
	liveDefaults,
	type AutomationDefaults,
	type DefaultsChoice,
} from '$lib/app/domain/automation-defaults';
import { automationsLoadQuery } from '$lib/automations/application/queries/automations-load.query.svelte';
import { builtinAutomationDefinitionsQuery } from '$lib/automations/application/queries/builtin-automation-definitions.query.svelte';
import { brainQuery } from '$lib/brain/application/queries/brain.query.svelte';

export { automationDefaultsQuery };

class AutomationDefaultsQuery {
	public readonly data: Readonly<{
		ready: boolean;
		live: AutomationDefaults;
		choice: DefaultsChoice;
		settingUpBrain: boolean;
	}> = $derived({
		ready: automationsLoadQuery.data.state === 'ready',
		live: liveDefaults(builtinAutomationDefinitionsQuery.data),
		choice: defaultsChoice(builtinAutomationDefinitionsQuery.data),
		settingUpBrain: brainQuery.data.settingUp,
	});
}

const automationDefaultsQuery = new AutomationDefaultsQuery();
