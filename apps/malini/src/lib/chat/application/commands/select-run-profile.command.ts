import {
	writeStoredRunProfile,
	writeStoredWorkstreamModel,
} from '$lib/chat/infrastructure/services/model-preferences.storage';
import { chatOccupancy } from '$lib/chat/infrastructure/services/chat-occupancy.service';
import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import {
	isValidAgentRunProfile,
	roleForAgentMode,
	selectionForRole,
	type AgentRunProfile,
} from '$shared/providers/providers.api';

export { selectRunProfileCommand };

function selectRunProfileCommand(nextProfile: AgentRunProfile): void {
	if (!isValidAgentRunProfile(nextProfile)) return;
	const workstreamId = chatRoute.workstreamId;
	if (!workstreamId) return;
	const role = roleForAgentMode(nextProfile.mode);
	const selection = selectionForRole(chatModelStore.workstreamPreferences, role);
	chatModelStore.noteUserChoice();
	chatModelStore.model = selection.model;
	chatModelStore.profile = {
		mode: role === 'planning' ? 'plan' : 'agent',
		effort: nextProfile.effort,
		access: nextProfile.access,
	};
	writeStoredWorkstreamModel(workstreamId, selection.model);
	writeStoredRunProfile(workstreamId, chatModelStore.profile);
	chatSessionStore.createFreshSessionOnNextPrompt = chatOccupancy.freshSessionRequired(
		chatSessionStore.sessionId,
		role,
		selection,
	);
	chatSessionStore.bootError = null;
}
