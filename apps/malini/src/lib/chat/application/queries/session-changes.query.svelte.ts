import { sessionChangesStore } from '$lib/chat/infrastructure/stores/session-changes.store.svelte';
import type { AgentSessionChanges } from '$shared/repositories/repositories.api';

export { sessionChangesQuery };

class SessionChangesQuery {
	public readonly data: AgentSessionChanges | null = $derived(sessionChangesStore.changes);
}

const sessionChangesQuery = new SessionChangesQuery();
