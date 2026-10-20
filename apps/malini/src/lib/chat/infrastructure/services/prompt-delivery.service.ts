import { errorMessage } from '$lib/chat/domain/error-message';
import {
	PromptDispatchError,
	promptDispatchStage,
	stagedDispatchFailure,
} from '$lib/chat/domain/prompt-dispatch-error';
import {
	classifyPromptDispatchFailure,
	type PromptDispatchStage,
} from '$lib/chat/domain/prompt-dispatch-failure';
import { runIdForPromptRequest } from '$contract/chat-identity';
import { newPromptRequestId } from '$lib/chat/domain/prompt-identity';
import type { PromptDispatch } from '$lib/chat/domain/prompt-submission';
import type { QueueDrainOutcome } from '$lib/chat/domain/queue-drain-outcome';
import type { QueuedPrompt } from '$lib/chat/domain/queued-prompt';
import type { SessionId } from '$lib/chat/domain/session';
import type { SubmissionSessionTarget } from '$lib/chat/domain/submission-session-target';
import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { agentEventStream } from '$lib/chat/infrastructure/services/agent-event-stream.service';
import { agentRunner } from '$lib/chat/infrastructure/services/agent-runner.service.svelte';
import { chatOccupancy } from '$lib/chat/infrastructure/services/chat-occupancy.service';
import {
	writeChatModelSnapshot,
	writeStoredRunProfile,
} from '$lib/chat/infrastructure/services/model-preferences.storage';
import { sessionActivation } from '$lib/chat/infrastructure/services/session-activation.service';
import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { pendingPromptStore } from '$lib/chat/infrastructure/stores/pending-prompt.store.svelte';
import { queueDrainStore } from '$lib/chat/infrastructure/stores/queue-drain.store';
import { queueErrorsStore } from '$lib/chat/infrastructure/stores/queue-errors.store.svelte';
import { queueInterruptRecoveryStore } from '$lib/chat/infrastructure/stores/queue-interrupt-recovery.store';
import { queueSendingStore } from '$lib/chat/infrastructure/stores/queue-sending.store.svelte';
import { roleForAgentMode, sameModelSelection } from '$shared/providers/providers.api';
import { workstreamReadyForPromptsQuery } from '$shared/repositories/repositories.api';

const QUEUE_INTERRUPT_RETRY_INTERVAL_MS = 100;
const QUEUE_INTERRUPT_MAX_ATTEMPTS = 100;

class PromptDeliveryService {
	#openings = 0;

	open(): void {
		this.#openings += 1;
		if (this.#openings > 1) return;
		const released = queueDrainStore.takeReleases();
		this.#shut();
		queueDrainStore.accepting = true;
		for (const workstreamId of released) this.scheduleDrain(workstreamId);
	}

	release(workstreamId: string): void {
		if (queueDrainStore.accepting) {
			this.scheduleDrain(workstreamId);
			return;
		}
		queueDrainStore.holdRelease(workstreamId);
	}

	close(): void {
		this.#openings = Math.max(0, this.#openings - 1);
		if (this.#openings > 0) return;
		this.#shut();
	}

	__resetForTests(): void {
		this.#openings = 0;
		this.#shut();
	}

	#shut(): void {
		this.disarmEveryInterruptRecovery();
		queueDrainStore.reset();
		queueSendingStore.reset();
		queueErrorsStore.reset();
	}

	scheduleDrain(workstreamId: string): void {
		queueMicrotask(() => {
			if (queueDrainStore.accepting) void this.drain(workstreamId);
		});
	}

	async dispatch(input: PromptDispatch): Promise<string> {
		const record = sessionsAggregate.getSession(input.sessionId);
		const requestedSelection = { model: input.model };
		if (
			!record ||
			record.workstreamId !== input.workstreamId ||
			!sameModelSelection(chatModelStore.selectionForSession(record), requestedSelection)
		) {
			throw new PromptDispatchError(
				'deliver',
				`Queued ${input.role} turn requires a fresh ${input.model} session`,
			);
		}
		if (roleForAgentMode(input.profile.mode) !== input.role) {
			throw new PromptDispatchError(
				'deliver',
				`Queued ${input.role} turn has an incompatible run profile`,
			);
		}
		writeChatModelSnapshot(input.sessionId, {
			role: input.role,
			selection: requestedSelection,
		});
		const requestId = input.queueId ?? input.requestId ?? newPromptRequestId();
		const dispatchedRunId = runIdForPromptRequest(requestId);
		chatSessionStore.beginDispatch(input.sessionId, dispatchedRunId);
		if (input.queueId) {
			queueSendingStore.set(input.workstreamId, input.queueId);
			agentPromptQueue.handOff(input.queueId);
		}
		pendingPromptStore.set({
			sessionId: input.sessionId,
			origin: input.queueId ? 'queue' : 'composer',
			runId: dispatchedRunId,
			text: input.prompt,
			attachments: input.attachments.map((attachment) => ({ ...attachment })),
		});

		let stage: PromptDispatchStage = 'prepare-stream';
		let runId: string;
		try {
			await agentEventStream.ensureStarted();
			stage = 'deliver';
			runId = await agentRunner.sendPrompt({
				sessionId: input.sessionId,
				prompt: input.prompt.trim(),
				...(input.contextFiles.length ? { contextFiles: [...input.contextFiles] } : {}),
				...(input.attachments.length
					? { attachmentIds: input.attachments.map((attachment) => attachment.id) }
					: {}),
				...(input.transcriptReferences.length
					? {
							transcriptReferences: input.transcriptReferences.map((reference) => ({
								...reference,
							})),
						}
					: {}),
				...(input.elementReferences.length
					? {
							elementReferences: input.elementReferences.map((reference) => ({
								...reference,
								rect: { ...reference.rect },
							})),
						}
					: {}),
				clientRequestId: requestId,
				profile: input.profile,
				...(input.automated === true ? { automated: true } : {}),
				...(input.steer === true ? { steer: true } : {}),
			});
		} catch (error) {
			chatSessionStore.settleDispatch(input.sessionId);
			if (!input.queueId || !isTransientDispatchFailure(stage, error)) {
				pendingPromptStore.clearForSession(input.sessionId);
				if (input.queueId) agentPromptQueue.takeBack(input.queueId);
			}
			queueSendingStore.release(input.workstreamId, input.queueId);
			throw stagedDispatchFailure(stage, error, 'sendPrompt failed');
		}
		if (input.queueId) {
			agentPromptQueue.remove(input.workstreamId, input.queueId);
			queueErrorsStore.clear(input.queueId);
		}
		chatModelStore.rememberRoleSelection(input.role, requestedSelection);
		writeStoredRunProfile(input.workstreamId, input.profile);
		if (
			chatRoute.workstreamId === input.workstreamId &&
			chatSessionStore.sessionId === input.sessionId
		) {
			chatModelStore.model = input.model;
			chatModelStore.profile = { ...input.profile };
			chatSessionStore.bootError = null;
		}
		queueSendingStore.release(input.workstreamId, input.queueId);
		await this.#refreshSessionTabsForAcceptedPrompt(input.workstreamId);
		return runId;
	}

	async drain(workstreamId: string): Promise<QueueDrainOutcome> {
		agentPromptQueue.hydrate(workstreamId);
		if (
			!workstreamId ||
			agentPromptQueue.isPaused(workstreamId) ||
			queueDrainStore.isLocked(workstreamId) ||
			!workstreamReadyForPromptsQuery.data(workstreamId)
		) {
			return 'skipped';
		}
		const deliverable = nextDeliverable(workstreamId);
		if (!deliverable) return 'skipped';
		return this.#deliver(workstreamId, deliverable.next, deliverable.target.targetSessionId, false);
	}

	async steer(
		workstreamId: string,
		sessionId: SessionId,
		entry: QueuedPrompt,
	): Promise<QueueDrainOutcome> {
		if (!queueDrainStore.isLocked(workstreamId)) {
			return this.#deliver(workstreamId, entry, sessionId, true);
		}
		this.armInterruptRecovery(workstreamId, sessionId, entry.id, true);
		return 'busy-retry';
	}

	async #deliver(
		workstreamId: string,
		next: QueuedPrompt,
		sessionId: SessionId | null,
		steer: boolean,
	): Promise<QueueDrainOutcome> {
		const lock = queueDrainStore.lock(workstreamId);
		let dispatchSessionId = sessionId;
		try {
			const requestedSelection = { model: next.model };
			let targetSessionId = sessionId;
			if (!targetSessionId) {
				try {
					targetSessionId = await sessionActivation.mint({
						workstreamId,
						role: next.role,
						selection: requestedSelection,
						activate: chatRoute.workstreamId === workstreamId,
					});
				} catch (error) {
					throw stagedDispatchFailure('prepare-session', error, 'Agent runtime unavailable');
				}
			}
			dispatchSessionId = targetSessionId;
			agentPromptQueue.update(workstreamId, next.id, {
				prompt: next.prompt,
				targetSessionId,
				forceFreshSession: false,
			});
			await this.dispatch({
				workstreamId,
				sessionId: targetSessionId,
				prompt: next.prompt,
				role: next.role,
				model: next.model,
				profile: next.profile,
				contextFiles: next.contextFiles,
				attachments: next.attachments,
				transcriptReferences: next.transcriptReferences,
				elementReferences: next.elementReferences,
				queueId: next.id,
				...(steer ? { steer } : {}),
			});
			this.scheduleDrain(workstreamId);
			return 'dispatched';
		} catch (error) {
			const message = errorMessage(error, 'Failed to send queued prompt');
			const failure = classifyPromptDispatchFailure({
				stage: promptDispatchStage(error),
				message,
			});
			if (failure === 'already-running' || failure === 'cancel-race') {
				if (dispatchSessionId) {
					this.armInterruptRecovery(workstreamId, dispatchSessionId, next.id, steer);
				}
				return 'busy-retry';
			}
			if (failure === 'session-boot' && chatRoute.workstreamId === workstreamId) {
				chatSessionStore.bootError = message;
			} else {
				queueErrorsStore.set(next.id, message);
			}
			return 'failed';
		} finally {
			queueDrainStore.unlock(workstreamId, lock);
		}
	}

	armInterruptRecovery(
		workstreamId: string,
		sessionId: SessionId,
		entryId: string,
		steer = false,
	): void {
		queueSendingStore.set(workstreamId, entryId);
		if (queueInterruptRecoveryStore.get(workstreamId)?.entryId === entryId) return;
		this.disarmInterruptRecovery(workstreamId);
		queueInterruptRecoveryStore.set(workstreamId, {
			entryId,
			sessionId,
			steer,
			attempts: 0,
			timer: this.#scheduleInterruptAttempt(workstreamId),
		});
	}

	disarmInterruptRecovery(workstreamId: string): void {
		const recovery = queueInterruptRecoveryStore.get(workstreamId);
		if (!recovery) return;
		clearTimeout(recovery.timer);
		queueInterruptRecoveryStore.delete(workstreamId);
		queueSendingStore.release(workstreamId, recovery.entryId);
		if (!queuedPromptById(workstreamId, recovery.entryId)) return;
		this.withdrawFromTranscript(recovery.sessionId, recovery.entryId);
	}

	withdrawFromTranscript(sessionId: SessionId, entryId: string): void {
		agentPromptQueue.takeBack(entryId);
		if (pendingPromptStore.for(sessionId)?.runId === runIdForPromptRequest(entryId)) {
			pendingPromptStore.clearForSession(sessionId);
		}
	}

	disarmEveryInterruptRecovery(): void {
		for (const workstreamId of queueInterruptRecoveryStore.workstreamIds()) {
			this.disarmInterruptRecovery(workstreamId);
		}
	}

	isRecoveringEntry(workstreamId: string, entryId: string): boolean {
		return queueInterruptRecoveryStore.get(workstreamId)?.entryId === entryId;
	}

	#scheduleInterruptAttempt(workstreamId: string): ReturnType<typeof setTimeout> {
		return setTimeout(
			() => void this.#attemptInterruptRecovery(workstreamId),
			QUEUE_INTERRUPT_RETRY_INTERVAL_MS,
		);
	}

	async #attemptInterruptRecovery(workstreamId: string): Promise<void> {
		const recovery = queueInterruptRecoveryStore.get(workstreamId);
		if (!recovery) return;
		const entry = queuedPromptById(workstreamId, recovery.entryId);
		if (!entry) {
			this.disarmInterruptRecovery(workstreamId);
			return;
		}
		if (recovery.attempts >= QUEUE_INTERRUPT_MAX_ATTEMPTS) {
			const entryId = recovery.entryId;
			this.disarmInterruptRecovery(workstreamId);
			const message =
				'The interrupted response never finished. Send this prompt again once the chat is idle.';
			queueErrorsStore.set(entryId, message);
			return;
		}
		recovery.attempts += 1;
		try {
			await agentEventStream.hydrate(recovery.sessionId);
		} catch {}
		if (queueInterruptRecoveryStore.get(workstreamId) !== recovery) return;
		const outcome = recovery.steer
			? await this.steer(workstreamId, recovery.sessionId, entry)
			: await this.drain(workstreamId);
		if (queueInterruptRecoveryStore.get(workstreamId) !== recovery) return;
		if (outcome === 'failed' || !queuedPromptById(workstreamId, recovery.entryId)) {
			this.disarmInterruptRecovery(workstreamId);
			return;
		}
		recovery.timer = this.#scheduleInterruptAttempt(workstreamId);
	}

	async #refreshSessionTabsForAcceptedPrompt(workstreamId: string): Promise<void> {
		try {
			await sessionActivation.refreshSessionTabs(workstreamId);
		} catch {}
	}
}

function isTransientDispatchFailure(stage: PromptDispatchStage, error: unknown): boolean {
	const failure = classifyPromptDispatchFailure({ stage, message: error });
	return failure === 'already-running' || failure === 'cancel-race';
}

function nextDeliverable(
	workstreamId: string,
): { next: QueuedPrompt; target: SubmissionSessionTarget<SessionId> } | null {
	const waitingChats = new Set<SessionId | null>();
	for (const entry of agentPromptQueue.entriesFor(workstreamId)) {
		if (waitingChats.has(entry.targetSessionId)) continue;
		waitingChats.add(entry.targetSessionId);
		const target = chatOccupancy.queuedTurnTarget(workstreamId, entry);
		if (!target.targetIsBusy) return { next: entry, target };
	}
	return null;
}

function queuedPromptById(workstreamId: string, id: string): QueuedPrompt | null {
	return agentPromptQueue.entriesFor(workstreamId).find((entry) => entry.id === id) ?? null;
}

export const promptDelivery = new PromptDeliveryService();
