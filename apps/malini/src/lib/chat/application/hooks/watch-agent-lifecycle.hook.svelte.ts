import { chatRunningQuery } from '$lib/chat/application/queries/chat-running.query.svelte';
import { agentEventStream } from '$lib/chat/infrastructure/services/agent-event-stream.service';
import { agentRunner } from '$lib/chat/infrastructure/services/agent-runner.service.svelte';
import { sessionActivation } from '$lib/chat/infrastructure/services/session-activation.service';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

const OPEN_RUN_RECONCILE_INTERVAL_MS = 1_500;

export function watchAgentLifecycleHook(): () => void {
	$effect(() => {
		const sessionId = chatSessionStore.sessionId;
		if (!sessionId || !chatRunningQuery.data) return;

		const interval = setInterval(() => {
			void agentEventStream.hydrate(sessionId).catch(() => {});
		}, OPEN_RUN_RECONCILE_INTERVAL_MS);
		return () => clearInterval(interval);
	});

	$effect(() => {
		const runOpen = chatRunningQuery.data;
		const owner = sessionActivation.activeRunOwner();
		if (!owner) {
			agentRunner.setRunOpen(false);
			return;
		}
		agentRunner.setRunOpen(runOpen, owner);
	});

	return () => {
		agentRunner.setRunOpen(false);
	};
}
