import { activateChatCommand } from '$lib/chat/application/commands/activate-chat.command';
import { bootChatCommand } from '$lib/chat/application/commands/boot-chat.command';
import { openWorkstreamChatCommand } from '$lib/chat/application/commands/open-workstream-chat.command';
import { syncChatRouteCommand } from '$lib/chat/application/commands/sync-chat-route.command';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { transcriptAggregate } from '$lib/chat/infrastructure/aggregates/transcript.aggregate.svelte';
import { sessionActivation } from '$lib/chat/infrastructure/services/session-activation.service';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { closingChatsStore } from '$lib/chat/infrastructure/stores/closing-chats.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { streamingStore } from '$lib/chat/infrastructure/stores/streaming.store.svelte';

export function followChatRouteHook(): () => void {
	transcriptAggregate.reset();
	chatSessionStore.reset();
	transcriptAggregate.seedOwnersFromSessions();
	transcriptAggregate.seedProjection(chatRoute.workstreamId, chatRoute.readSessionParam());

	$effect.pre(() => {
		const workstreamId = chatRoute.workstreamId;
		if (!workstreamId || workstreamId === chatSessionStore.projectedFor) return;
		openWorkstreamChatCommand(workstreamId);
	});

	$effect(() => {
		const workstreamId = chatRoute.workstreamId;
		if (
			workstreamId &&
			workstreamId === chatSessionStore.projectedFor &&
			workstreamId !== chatSessionStore.bootstrappedFor
		) {
			bootChatCommand(workstreamId);
		}
	});

	$effect(() => {
		const next = transcriptAggregate.targetPresentation;
		if (!next) return;
		const retained = transcriptAggregate.retainedPresentation;
		if (retained?.workstreamId === next.workstreamId && retained.sessionId === next.sessionId) {
			return;
		}
		transcriptAggregate.retainedPresentation = next;
	});

	$effect(() => {
		const workstreamId = chatRoute.workstreamId;
		const requestedSessionId = chatRoute.requestedSessionId;
		if (!workstreamId) return;
		if (!chatRoute.stillTargets(workstreamId)) return;
		if (chatSessionStore.suppressRouteActivation) return;
		if (chatSessionStore.isPreparing(workstreamId)) return;
		if (chatSessionStore.bootError) return;
		if (
			chatSessionStore.emptySessionMode === 'fresh' &&
			chatSessionStore.createFreshSessionOnNextPrompt &&
			!requestedSessionId
		) {
			return;
		}
		const sessionId = chatSessionStore.sessionId;
		if (!requestedSessionId) {
			if (
				sessionId &&
				(!sessionsAggregate.getSession(sessionId) || closingChatsStore.sessionIds.has(sessionId))
			) {
				streamingStore.clearRun(sessionId);
				chatSessionStore.sessionId = null;
				chatSessionStore.emptySessionMode = 'fresh';
				sessionActivation.commitSessionlessPresentation(workstreamId);
				chatSessionStore.bootError = null;
				return;
			}
			if (
				sessionId &&
				chatSessionStore.bootstrappedFor === workstreamId &&
				chatSessionStore.bootingWorkstreamId !== workstreamId &&
				transcriptAggregate.ownerOf(sessionId) === workstreamId
			) {
				syncChatRouteCommand(sessionId, workstreamId);
			}
			return;
		}
		if (requestedSessionId === sessionId) {
			if (
				chatSessionStore.activationFollowsRoute &&
				chatSessionStore.activatingSessionId &&
				chatSessionStore.activatingSessionId !== requestedSessionId
			) {
				chatSessionStore.finishSelection(chatSessionStore.beginSelection(workstreamId, null));
			}
			return;
		}
		if (chatSessionStore.activatingSessionId !== requestedSessionId) {
			activateChatCommand(requestedSessionId, workstreamId);
		}
	});

	return () => {
		chatSessionStore.reset();
		transcriptAggregate.reset();
	};
}
