import type { SessionId } from '$lib/chat/domain/session';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { workstreamChatsPreloader } from '$lib/chat/infrastructure/services/workstream-chats-preloader.service';
import { goto } from '$shared/router/navigation';
import { workstreamHref } from '$shared/router/routes-hrefs';
import { workstreamTabs } from '$shared/shell/workstream-tabs.store.svelte';

export { openNotifiedChatCommand, NOTIFIED_CHAT_WARM_CAP_MS };

const NOTIFIED_CHAT_WARM_CAP_MS = 150;

type NotifiedChat = Readonly<{ workstreamId: string; sessionId: SessionId }>;

let latestOpening = 0;

function openNotifiedChatCommand(
	target: NotifiedChat,
	workstreamExists: (workstreamId: string) => boolean,
): void {
	const opening = ++latestOpening;
	void (async () => {
		const warmed = workstreamChatsPreloader.warmed(target.workstreamId, target.sessionId);
		await Promise.race([
			warmed,
			new Promise<void>((resolve) => setTimeout(resolve, NOTIFIED_CHAT_WARM_CAP_MS)),
		]);
		if (opening !== latestOpening || !workstreamExists(target.workstreamId)) return;
		if (!chatBelongsTo(target)) {
			await warmed;
			if (opening !== latestOpening) return;
		}
		const belongs = chatBelongsTo(target);
		if (belongs) workstreamTabs.leave(target.workstreamId);
		await goto(
			belongs
				? workstreamHref(target.workstreamId, { agentSessionId: target.sessionId })
				: workstreamHref(target.workstreamId),
		);
	})();
}

function chatBelongsTo(target: NotifiedChat): boolean {
	return sessionsAggregate.getSession(target.sessionId)?.workstreamId === target.workstreamId;
}
