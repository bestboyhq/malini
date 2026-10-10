import { sessionChangesStore } from '$lib/chat/infrastructure/stores/session-changes.store.svelte';
import type { AgentSessionChanges } from '$shared/repositories/repositories.api';

export { sessionChangesQuery };

class SessionChangesQuery {
	public readonly data: (sessionId: string | null) => AgentSessionChanges | null = $derived(
		(sessionId: string | null) => sessionChangesStore.changesFor(sessionId),
	);
}

const sessionChangesQuery = new SessionChangesQuery();
