import {
	writeStoredRunProfile,
	writeStoredWorkstreamModel,
} from '$lib/chat/infrastructure/services/model-preferences.storage';
import { chatOccupancy } from '$lib/chat/infrastructure/services/chat-occupancy.service';
import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { toast } from '$hyper-ui/components/toast';
import {
	roleForAgentMode,
	saveModelDefaultsCommand,
	selectionForRole,
	type ModelPreferences,
} from '$shared/providers/providers.api';

export { applyModelDefaultsCommand };

function applyModelDefaultsCommand(next: ModelPreferences): void {
	const workstreamId = chatRoute.workstreamId;
	if (!workstreamId) return;
	const role = roleForAgentMode(chatModelStore.profile.mode);
	saveModelDefaultsCommand(next);
	chatModelStore.adoptDefaults(workstreamId);
	const selection = selectionForRole(chatModelStore.workstreamPreferences, role);
	chatModelStore.noteUserChoice();
	chatModelStore.model = selection.model;
	writeStoredWorkstreamModel(workstreamId, selection.model);
	writeStoredRunProfile(workstreamId, chatModelStore.profile);
	chatSessionStore.createFreshSessionOnNextPrompt = chatOccupancy.freshSessionRequired(
		chatSessionStore.sessionId,
		role,
		selection,
	);
	chatSessionStore.bootError = null;
	toast.info('Model defaults saved · this workstream updated');
}
