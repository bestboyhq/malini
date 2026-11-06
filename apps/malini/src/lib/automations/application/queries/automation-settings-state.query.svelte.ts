import {
	automationActionsStore,
	automationSettingsActionId,
} from '$lib/automations/infrastructure/stores/automation-actions.store.svelte';

export { automationSettingsStateQuery };

class AutomationSettingsStateQuery {
	public readonly data: (
		automationId: string,
	) => Readonly<{ busy: boolean; error: string | null }> = $derived((automationId: string) => ({
		busy: automationActionsStore.isBusy(automationSettingsActionId(automationId)),
		error: automationActionsStore.errorFor(automationSettingsActionId(automationId)),
	}));
}

const automationSettingsStateQuery = new AutomationSettingsStateQuery();
