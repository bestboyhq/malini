import { chatOccupancy } from '$lib/chat/infrastructure/services/chat-occupancy.service';
import { rememberChatPick } from '$lib/chat/infrastructure/services/model-preferences.storage';
import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import {
	isValidModelSelection,
	roleForAgentMode,
	type ModelSelection,
} from '$shared/providers/providers.api';

export { selectModelCommand };

function selectModelCommand(nextSelection: ModelSelection): void {
	if (!isValidModelSelection(nextSelection)) return;
	const workstreamId = chatRoute.workstreamId;
	if (!workstreamId) return;
	const sessionId =
		chatModelStore.adoptPreview(chatRoute.requestedSessionId) ?? chatSessionStore.sessionId;
	chatModelStore.noteUserChoice();
	chatModelStore.selection = nextSelection;
	rememberChatPick(workstreamId, sessionId, chatModelStore.setup());
	chatSessionStore.createFreshSessionOnNextPrompt = chatOccupancy.freshSessionRequired(
		sessionId,
		roleForAgentMode(chatModelStore.profile.mode),
		nextSelection,
	);
	chatSessionStore.bootError = null;
}
