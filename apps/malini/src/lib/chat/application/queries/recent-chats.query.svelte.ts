import { newestWorkstreamChats } from '$lib/chat/domain/prepared-plan';
import type { SessionRecord } from '$lib/chat/domain/session-record';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';

export { recentChatsQuery };

const RECENT_CHAT_LIMIT = 4;

class RecentChatsQuery {
	public readonly data: (workstreamId: string) => readonly SessionRecord[] = $derived(
		(workstreamId: string) =>
			newestWorkstreamChats(sessionsAggregate.listSessions(), workstreamId).slice(
				0,
				RECENT_CHAT_LIMIT,
			),
	);
}

const recentChatsQuery = new RecentChatsQuery();
