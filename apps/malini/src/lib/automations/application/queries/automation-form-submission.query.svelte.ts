import {
	AUTOMATION_FORM_ACTION_ID,
	automationActionsStore,
} from '$lib/automations/infrastructure/stores/automation-actions.store.svelte';

export { automationFormSubmissionQuery };

class AutomationFormSubmissionQuery {
	public readonly data: Readonly<{ busy: boolean; error: string | null }> = $derived({
		busy: automationActionsStore.isBusy(AUTOMATION_FORM_ACTION_ID),
		error: automationActionsStore.errorFor(AUTOMATION_FORM_ACTION_ID),
	});
}

const automationFormSubmissionQuery = new AutomationFormSubmissionQuery();
