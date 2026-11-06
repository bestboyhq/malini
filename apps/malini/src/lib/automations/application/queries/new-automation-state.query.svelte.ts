import {
	automationActionsStore,
	NEW_AUTOMATION_ACTION_ID,
} from '$lib/automations/infrastructure/stores/automation-actions.store.svelte';

export { newAutomationStateQuery };

class NewAutomationStateQuery {
	public readonly data: Readonly<{ busy: boolean; error: string | null; completed: number }> =
		$derived({
			busy: automationActionsStore.isBusy(NEW_AUTOMATION_ACTION_ID),
			error: automationActionsStore.errorFor(NEW_AUTOMATION_ACTION_ID),
			completed: automationActionsStore.completedFor(NEW_AUTOMATION_ACTION_ID),
		});
}

const newAutomationStateQuery = new NewAutomationStateQuery();
