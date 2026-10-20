import { loadSessionChangesCommand } from '$lib/chat/application/commands/load-session-changes.command';
import { sessionChangesTargetQuery } from '$lib/chat/application/queries/session-changes-target.query.svelte';
import { transcriptAggregate } from '$lib/chat/infrastructure/aggregates/transcript.aggregate.svelte';
import { chatSessionChanges } from '$lib/chat/infrastructure/services/chat-session-changes.service';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { sessionChangesStore } from '$lib/chat/infrastructure/stores/session-changes.store.svelte';

export function watchSessionChangesHook(): () => void {
	sessionChangesStore.resetTracking();

	const unlisten = chatSessionChanges.onCaptured((capturedSessionId) => {
		if (capturedSessionId !== sessionChangesTargetQuery.data) return;
		sessionChangesStore.noteCapture();
	});

	const revision = $derived.by(() => {
		const sessionId = chatSessionStore.sessionId;
		const latestTerminal = sessionId
			? transcriptAggregate.summaryFor(sessionId).latestTerminalKey
			: null;
		return `${latestTerminal ?? ''}:${sessionChangesStore.capturedRevision}`;
	});

	$effect(() => {
		revision;
		const targetSessionId = sessionChangesTargetQuery.data;
		const workstreamId = chatRoute.workstreamId;
		chatSessionChanges.cancel();
		sessionChangesStore.nextOpenRevision();
		sessionChangesStore.openingPath = null;
		if (!targetSessionId) return;

		let disposed = false;
		loadSessionChangesCommand({
			workstreamId,
			sessionId: targetSessionId,
			isCancelled: () => disposed,
		});
		return () => {
			disposed = true;
			chatSessionChanges.cancel();
		};
	});

	return () => {
		unlisten();
		chatSessionChanges.cancel();
		sessionChangesStore.resetTracking();
	};
}
