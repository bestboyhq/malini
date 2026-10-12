import {
	automationRulesStore,
	type AutomationRunOption,
} from '$shared/extensions/automation-rules.store.svelte';

export { automationRunOptionsQuery };

class AutomationRunOptionsQuery {
	public readonly data: readonly AutomationRunOption[] | null = $derived(
		automationRulesStore.runOptions,
	);
}

const automationRunOptionsQuery = new AutomationRunOptionsQuery();
