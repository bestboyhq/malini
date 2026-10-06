import { untrack } from 'svelte';
import { preloadOpenChatsCommand } from '$lib/chat/application/commands/preload-open-chats.command';
import type { SessionId } from '$lib/chat/domain/session';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { transcriptAggregate } from '$lib/chat/infrastructure/aggregates/transcript.aggregate.svelte';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { closingChatsStore } from '$lib/chat/infrastructure/stores/closing-chats.store.svelte';

export function preloadOpenChatsHook(): () => void {
	const stop = $effect.root(() => {
		const loadedChat = $derived.by((): SessionId | null => {
			const currentSessionId = chatSessionStore.sessionId;
			if (!chatRoute.workstreamId || !currentSessionId) return null;
			return transcriptAggregate.targetPresentation?.sessionId === currentSessionId
				? currentSessionId
				: null;
		});
		const otherOpenChats = $derived.by((): string => {
			const workstreamId = chatRoute.workstreamId;
			const currentSessionId = loadedChat;
			if (!currentSessionId) return '';
			return sessionsAggregate
				.listSessions()
				.filter(
					(session) =>
						session.workstreamId === workstreamId &&
						session.id !== currentSessionId &&
						!closingChatsStore.sessionIds.has(session.id),
				)
				.sort((left, right) => right.startedAt.localeCompare(left.startedAt))
				.map((session) => session.id)
				.join('\n');
		});
		$effect(() => {
			const currentSessionId = loadedChat;
			const sessionIds: readonly SessionId[] = otherOpenChats ? otherOpenChats.split('\n') : [];
			untrack(() => preloadOpenChatsCommand(currentSessionId, sessionIds));
		});
	});
	return () => {
		stop();
		preloadOpenChatsCommand(null, []);
	};
}
