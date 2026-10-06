import {
	writeStoredRunProfile,
	writeStoredWorkstreamModel,
} from '$lib/chat/infrastructure/services/model-preferences.storage';
import { chatOccupancy } from '$lib/chat/infrastructure/services/chat-occupancy.service';
import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import {
	isValidAgentModel,
	roleForAgentMode,
	type AgentModel,
} from '$shared/providers/providers.api';

export { selectModelCommand };

function selectModelCommand(nextModel: AgentModel): void {
	if (!isValidAgentModel(nextModel)) return;
	const role = roleForAgentMode(chatModelStore.profile.mode);
	chatModelStore.noteUserChoice();
	chatModelStore.model = nextModel;
	const workstreamId = chatRoute.workstreamId;
	if (!workstreamId) return;
	chatModelStore.rememberRoleSelection(workstreamId, role, { model: nextModel });
	writeStoredWorkstreamModel(workstreamId, nextModel);
	writeStoredRunProfile(workstreamId, chatModelStore.profile);
	chatSessionStore.createFreshSessionOnNextPrompt = chatOccupancy.freshSessionRequired(
		chatSessionStore.sessionId,
		role,
		{ model: nextModel },
	);
	chatSessionStore.bootError = null;
}
