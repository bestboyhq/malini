import { automationActionsStore } from '$lib/automations/infrastructure/stores/automation-actions.store.svelte';

export { automationActionStateQuery };

class AutomationActionStateQuery {
	public readonly data: (id: string) => Readonly<{ busy: boolean; error: string | null }> =
		$derived((id: string) => ({
			busy: automationActionsStore.isBusy(id),
			error: automationActionsStore.errorFor(id),
		}));
}

const automationActionStateQuery = new AutomationActionStateQuery();
