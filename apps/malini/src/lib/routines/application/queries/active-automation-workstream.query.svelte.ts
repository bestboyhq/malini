import { automationRulesStore } from '$shared/extensions/automation-rules.store.svelte';

export { activeAutomationWorkstreamQuery };

class ActiveAutomationWorkstreamQuery {
	public readonly data: string | null = $derived(automationRulesStore.activeWorkstreamId);
}

const activeAutomationWorkstreamQuery = new ActiveAutomationWorkstreamQuery();
