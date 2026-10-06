import type { SessionRecord } from '$lib/chat/domain/session-record';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';

export { workstreamChatsQuery };

class WorkstreamChatsQuery {
	public readonly data: (workstreamId: string) => readonly SessionRecord[] = $derived(
		(workstreamId: string) =>
			sessionsAggregate.listSessions().filter((session) => session.workstreamId === workstreamId),
	);
}

const workstreamChatsQuery = new WorkstreamChatsQuery();
