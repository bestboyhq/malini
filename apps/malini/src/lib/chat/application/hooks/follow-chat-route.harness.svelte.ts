import { connectAgentEventsHook } from '$lib/chat/application/hooks/connect-agent-events.hook';
import { followChatRouteHook } from '$lib/chat/application/hooks/follow-chat-route.hook.svelte';
import { presentedTranscriptQuery } from '$lib/chat/application/queries/presented-transcript.query.svelte';
import type { SessionId } from '$lib/chat/domain/session';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

export type PresentedFrame = Readonly<{
	routeWorkstreamId: string;
	presentedWorkstreamId: string;
	presentedSessionId: SessionId | null;
	envelopeSessionIds: readonly SessionId[];
	activeSessionId: SessionId | null;
}>;

export type ChatRouteHarness = Readonly<{
	frames: readonly PresentedFrame[];
	release(): void;
}>;

export function mountChatRoute(): ChatRouteHarness {
	const frames: PresentedFrame[] = [];
	let releaseHooks = (): void => {};

	const stop = $effect.root(() => {
		const releaseChatRoute = followChatRouteHook();
		const releaseAgentEvents = connectAgentEventsHook();
		releaseHooks = () => {
			releaseAgentEvents();
			releaseChatRoute();
		};
		frames.push(captureFrame());

		$effect.pre(() => {
			frames.push(captureFrame());
		});
	});

	return {
		frames,
		release(): void {
			stop();
			releaseHooks();
		},
	};
}

function captureFrame(): PresentedFrame {
	const presented = presentedTranscriptQuery.data;
	return {
		routeWorkstreamId: chatRoute.workstreamId,
		presentedWorkstreamId: presented.workstreamId,
		presentedSessionId: presented.sessionId,
		envelopeSessionIds: presented.envelopes.map((envelope) => envelope.sessionId),
		activeSessionId: chatSessionStore.sessionId,
	};
}
