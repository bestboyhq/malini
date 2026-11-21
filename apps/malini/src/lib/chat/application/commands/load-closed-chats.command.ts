import { closedChatsAggregate } from '$lib/chat/infrastructure/aggregates/closed-chats.aggregate.svelte';
import { agentSessions } from '$lib/chat/infrastructure/services/agent-sessions.service';

export { loadClosedChatsCommand };

const latestLoads = new Map<string, number>();

function loadClosedChatsCommand(workstreamId: string): void {
	if (!workstreamId) return;
	const load = (latestLoads.get(workstreamId) ?? 0) + 1;
	latestLoads.set(workstreamId, load);
	void (async () => {
		try {
			const chats = await agentSessions.listClosed(workstreamId);
			if (latestLoads.get(workstreamId) === load) closedChatsAggregate.replace(workstreamId, chats);
		} catch {}
	})();
}
