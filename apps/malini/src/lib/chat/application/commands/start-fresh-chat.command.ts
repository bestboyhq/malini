import { errorMessage } from '$lib/chat/domain/error-message';
import { readNewChatSetup } from '$lib/chat/infrastructure/services/model-preferences.storage';
import { sessionActivation } from '$lib/chat/infrastructure/services/session-activation.service';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import { worktreePendingQuery } from '$shared/repositories/repositories.api';

export { startFreshChatCommand };

async function startFreshChatCommand(): Promise<void> {
	const workstreamId = chatRoute.workstreamId;
	if (!workstreamId || worktreePendingQuery.data(workstreamId)) return;
	try {
		const sessionId = await sessionActivation.mint({
			workstreamId,
			setup: readNewChatSetup(workstreamId),
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
