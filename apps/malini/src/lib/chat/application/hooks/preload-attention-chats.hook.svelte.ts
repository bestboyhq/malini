import { untrack } from 'svelte';
import { preloadAttentionChatsCommand } from '$lib/chat/application/commands/preload-attention-chats.command';
import type { SessionId } from '$lib/chat/domain/session';
import { agentActivity } from '$lib/chat/infrastructure/aggregates/agent-activity.aggregate.svelte';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';

export function preloadAttentionChatsHook(readWorkstreamIds: () => readonly string[]): () => void {
	const stop = $effect.root(() => {
		const attentionChats = $derived.by((): string => {
			const workstreamIds = new Set(readWorkstreamIds());
			const sessionIds = new Set<SessionId>();
			for (const workstreamId of workstreamIds) {
				const sessionId = agentActivity.attentionFor(workstreamId)?.sessionId;
				if (sessionId) sessionIds.add(sessionId);
			}
			for (const session of sessionsAggregate.listSessions()) {
				if (session.status === 'waiting_for_approval' && workstreamIds.has(session.workstreamId)) {
					sessionIds.add(session.id);
				}
			}
			return [...sessionIds].join('\n');
		});
		$effect(() => {
			const sessionIds: readonly SessionId[] = attentionChats ? attentionChats.split('\n') : [];
			untrack(() => preloadAttentionChatsCommand(sessionIds));
		});
	});
	return () => {
		stop();
		preloadAttentionChatsCommand([]);
	};
}
