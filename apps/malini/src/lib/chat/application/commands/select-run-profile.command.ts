import { chatOccupancy } from '$lib/chat/infrastructure/services/chat-occupancy.service';
import { rememberChatPick } from '$lib/chat/infrastructure/services/model-preferences.storage';
import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import {
	isValidAgentRunProfile,
	modelDefaultsQuery,
	roleForAgentMode,
	selectionForRole,
	type AgentRunProfile,
} from '$shared/providers/providers.api';

export { selectRunProfileCommand };

function selectRunProfileCommand(nextProfile: AgentRunProfile): void {
	if (!isValidAgentRunProfile(nextProfile)) return;
	const workstreamId = chatRoute.workstreamId;
	if (!workstreamId) return;
	const sessionId =
		chatModelStore.adoptPreview(chatRoute.requestedSessionId) ?? chatSessionStore.sessionId;
	const role = roleForAgentMode(nextProfile.mode);
	const selection =
		nextProfile.mode === chatModelStore.profile.mode
			? chatModelStore.currentSelection()
			: selectionForRole(modelDefaultsQuery.data, role);
	chatModelStore.noteUserChoice();
	chatModelStore.show({ selection, profile: nextProfile });
	rememberChatPick(workstreamId, sessionId, chatModelStore.setup());
	chatSessionStore.createFreshSessionOnNextPrompt = chatOccupancy.freshSessionRequired(
		sessionId,
		role,
		selection,
	);
	chatSessionStore.bootError = null;
}
