import {
	checkpointEditTargetIsCurrent,
	type CheckpointEditTarget,
} from '$lib/chat/domain/checkpoint-edit-target';
import type { SessionId } from '$lib/chat/domain/session';
import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { transcriptAggregate } from '$lib/chat/infrastructure/aggregates/transcript.aggregate.svelte';
import { agentEventStream } from '$lib/chat/infrastructure/services/agent-event-stream.service';
import { chatBootstrap } from '$lib/chat/infrastructure/services/chat-bootstrap.service';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { pendingPromptStore } from '$lib/chat/infrastructure/stores/pending-prompt.store.svelte';
import { queueDrainStore } from '$lib/chat/infrastructure/stores/queue-drain.store';
import { queueSendingStore } from '$lib/chat/infrastructure/stores/queue-sending.store.svelte';
import { streamingStore } from '$lib/chat/infrastructure/stores/streaming.store.svelte';
import { invoke } from '$shared/port/invoke';

class CheckpointService {
	targetIsCurrent(target: Pick<CheckpointEditTarget, 'workstreamId' | 'sessionId'>): boolean {
		return checkpointEditTargetIsCurrent(target, {
			workstreamId: chatRoute.workstreamId,
			sessionId: chatSessionStore.sessionId,
			navigationTargetsWorkstream: chatRoute.stillTargets(target.workstreamId),
		});
	}

	async rewind(
		checkpointId: string,
		target: CheckpointEditTarget,
		selectionGenerationAtStart: number,
	): Promise<boolean> {
		if (!this.#selectionStillCurrent(target, selectionGenerationAtStart)) return false;
		if (this.#runIsOpen()) {
			throw new Error('Wait for the active run to finish before restoring a checkpoint');
		}

		await invoke('chat.restore-checkpoint', {
			workstreamId: target.workstreamId,
			checkpointId,
		});
		if (!this.#selectionStillCurrent(target, selectionGenerationAtStart)) return false;

		await agentEventStream.restart();
		if (!this.#selectionStillCurrent(target, selectionGenerationAtStart)) return false;

		this.#discardSessionProjections(target.workstreamId, target.sessionId);
		const seq = chatSessionStore.nextBootstrapSeq();
		await chatBootstrap.run(target.workstreamId, seq, target.sessionId);
		if (
			chatRoute.workstreamId !== target.workstreamId ||
			!chatRoute.stillTargets(target.workstreamId)
		) {
			return false;
		}
		if (chatSessionStore.bootError) throw new Error(chatSessionStore.bootError);
		return this.targetIsCurrent(target);
	}

	async redo(input: {
		workstreamId: string;
		sessionId: SessionId;
		restoreSeq: number;
	}): Promise<void> {
		await invoke('chat.redo-checkpoint-restore', {
			workstreamId: input.workstreamId,
			sessionId: input.sessionId,
			restoreSeq: input.restoreSeq,
		});
	}

	#selectionStillCurrent(target: CheckpointEditTarget, selectionGeneration: number): boolean {
		return (
			selectionGeneration === chatSessionStore.selectionGeneration && this.targetIsCurrent(target)
		);
	}

	#runIsOpen(): boolean {
		const sessionId = chatSessionStore.sessionId;
		if (!sessionId) return false;
		const status = sessionsAggregate.getSession(sessionId)?.status ?? 'idle';
		return (
			status === 'running' ||
			status === 'waiting_for_approval' ||
			chatSessionStore.isDispatchPending(sessionId)
		);
	}

	#discardSessionProjections(workstreamId: string, sessionId: SessionId): void {
		agentPromptQueue.clear(workstreamId);
		queueDrainStore.forceUnlock(workstreamId);
		queueSendingStore.set(workstreamId, null);
		pendingPromptStore.clearForSession(sessionId);
		streamingStore.clearRun(sessionId);
		sessionsAggregate.reset();
		transcriptAggregate.resetProjections();
		chatSessionStore.dispatchPendingBySession = {};
		chatSessionStore.sessionId = null;
		chatSessionStore.bootError = null;
	}
}

export const checkpoints = new CheckpointService();
