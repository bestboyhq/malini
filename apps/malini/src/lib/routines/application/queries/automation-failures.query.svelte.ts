import { automationRulesStore } from '$shared/extensions/automation-rules.store.svelte';

export { automationFailuresQuery };

class AutomationFailuresQuery {
	public readonly data: (routineId: string) => string | null = $derived(
		(routineId: string) =>
			automationRulesStore.failures.find((failure) => failure.ruleId === routineId)?.message ??
			null,
	);
}

const automationFailuresQuery = new AutomationFailuresQuery();
