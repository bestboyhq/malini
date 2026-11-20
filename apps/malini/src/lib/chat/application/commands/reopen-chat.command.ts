import { loadClosedChatsCommand } from '$lib/chat/application/commands/load-closed-chats.command';
import { errorMessage } from '$lib/chat/domain/error-message';
import type { SessionId } from '$lib/chat/domain/session';
import { closedChatsAggregate } from '$lib/chat/infrastructure/aggregates/closed-chats.aggregate.svelte';
import { agentSessions } from '$lib/chat/infrastructure/services/agent-sessions.service';
import { sessionActivation } from '$lib/chat/infrastructure/services/session-activation.service';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import { goto } from '$shared/router/navigation';
import { workstreamHref } from '$shared/router/routes-hrefs';
import { workstreamTabs } from '$shared/shell/workstream-tabs.store.svelte';

export { reopenChatCommand };

let reopening: Promise<void> = Promise.resolve();

function reopenChatCommand(workstreamId: string, sessionId: SessionId | null = null): void {
	if (!workstreamId) return;
	const previous = reopening;
	reopening = (async () => {
		await previous;
		await reopen(workstreamId, sessionId);
	})();
}

async function reopen(workstreamId: string, sessionId: SessionId | null): Promise<void> {
	try {
		const target = sessionId ?? (await agentSessions.listClosed(workstreamId))[0]?.id;
		if (!target) return;
		closedChatsAggregate.remove(workstreamId, target);
		await agentSessions.reopen(target);
		await sessionActivation.refreshSessionTabs(workstreamId);
		workstreamTabs.leave(workstreamId);
		await goto(
			chatRoute.isCurrentWorkstream(workstreamId)
				? chatRoute.hrefWithSession(target)
				: workstreamHref(workstreamId, { agentSessionId: target }),
		);
	} catch (cause) {
		toast.error(
			`Could not reopen the chat · ${errorMessage(cause, 'Reopen failed')}`,
			aboutWorkstream(workstreamId),
		);
	} finally {
		loadClosedChatsCommand(workstreamId);
	}
}
