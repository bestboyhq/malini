import { errorMessage } from '$lib/chat/domain/error-message';
import { sessionActivation } from '$lib/chat/infrastructure/services/session-activation.service';
import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import { defaultAgentModel, roleForAgentMode } from '$shared/providers/providers.api';

export { startFreshChatCommand };

async function startFreshChatCommand(): Promise<void> {
	const workstreamId = chatRoute.workstreamId;
	if (!workstreamId) return;
	try {
		const sessionId = await sessionActivation.mint({
			workstreamId,
			role: roleForAgentMode(chatModelStore.profile.mode),
			selection: { model: chatModelStore.model ?? defaultAgentModel() },
			activate: false,
		});
		if (chatRoute.isCurrentWorkstream(workstreamId)) {
			await sessionActivation.activate(sessionId, workstreamId);
		}
	} catch (cause) {
		toast.error(
			`Could not start agent chat · ${errorMessage(cause, 'Start failed')}`,
			aboutWorkstream(workstreamId),
		);
	}
}
