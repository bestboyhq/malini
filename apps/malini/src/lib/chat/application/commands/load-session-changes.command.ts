import { chatSessionChanges } from '$lib/chat/infrastructure/services/chat-session-changes.service';
import { sessionChangesStore } from '$lib/chat/infrastructure/stores/session-changes.store.svelte';

export { loadSessionChangesCommand };

function loadSessionChangesCommand(input: {
	workstreamId: string;
	sessionId: string;
	isCancelled: () => boolean;
}): void {
	void (async () => {
		const changes = await chatSessionChanges
			.load({ workstreamId: input.workstreamId, sessionId: input.sessionId })
			.catch(() => null);
		if (!input.isCancelled() && changes) sessionChangesStore.changes = changes;
	})();
}
