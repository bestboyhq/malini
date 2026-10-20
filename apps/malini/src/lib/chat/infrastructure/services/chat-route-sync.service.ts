import type { SessionId } from '$lib/chat/domain/session';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { goto } from '$shared/router/navigation';

class ChatRouteSyncService {
	#active: Readonly<{
		workstreamId: string;
		sessionId: SessionId;
		promise: Promise<void>;
	}> | null = null;

	async clearSessionUrl(workstreamId = chatRoute.workstreamId): Promise<void> {
		if (!chatRoute.isCurrentWorkstream(workstreamId)) return;
		if (!chatRoute.hasSessionParam()) return;
		await goto(chatRoute.hrefWithoutSession(), {
			replaceState: true,
			noScroll: true,
			keepFocus: true,
		});
	}

	syncSessionUrl(sessionId: SessionId, workstreamId = chatRoute.workstreamId): Promise<void> {
		if (this.#active?.workstreamId === workstreamId && this.#active.sessionId === sessionId) {
			return this.#active.promise;
		}
		let promise!: Promise<void>;
		promise = this.#synchronize(sessionId, workstreamId).finally(() => {
			if (this.#active?.promise === promise) this.#active = null;
		});
		this.#active = { workstreamId, sessionId, promise };
		return promise;
	}

	async #synchronize(sessionId: SessionId, workstreamId: string): Promise<void> {
		let targetSessionId = sessionId;
		while (chatRoute.isCurrentWorkstream(workstreamId)) {
			if (chatRoute.readSessionParam() === targetSessionId) return;
			const generationBeforeNavigation = chatSessionStore.selectionGeneration;
			await goto(chatRoute.hrefWithSession(targetSessionId), {
				replaceState: true,
				noScroll: true,
				keepFocus: true,
			});
			if (!chatRoute.isCurrentWorkstream(workstreamId)) return;
			if (generationBeforeNavigation === chatSessionStore.selectionGeneration) return;

			const latestTarget = chatSessionStore.activatingSessionId ?? chatSessionStore.sessionId;
			if (!latestTarget) return;
			targetSessionId = latestTarget;
		}
	}
}

export const chatRouteSync = new ChatRouteSyncService();
