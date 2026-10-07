import { tick } from 'svelte';
import { drainPromptQueueCommand } from '$lib/chat/application/commands/drain-prompt-queue.command';
import { enqueuePromptCommand } from '$lib/chat/application/commands/enqueue-prompt.command';
import { errorMessage } from '$lib/chat/domain/error-message';
import { promptDispatchStage } from '$lib/chat/domain/prompt-dispatch-error';
import { classifyPromptDispatchFailure } from '$lib/chat/domain/prompt-dispatch-failure';
import { runIdForPromptRequest } from '$contract/chat-identity';
import type { PromptRequest, PromptTurn } from '$lib/chat/domain/prompt-submission';
import type { SessionId } from '$lib/chat/domain/session';
import {
	resolveSubmissionSessionTarget,
	shouldForceFreshSessionAfterQueuedTurn,
} from '$lib/chat/domain/submission-session-target';
import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import { chatOccupancy } from '$lib/chat/infrastructure/services/chat-occupancy.service';
import { promptDelivery } from '$lib/chat/infrastructure/services/prompt-delivery.service';
import { sessionActivation } from '$lib/chat/infrastructure/services/session-activation.service';
import { chatRequestsStore } from '$lib/chat/infrastructure/stores/chat-requests.store.svelte';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { pendingPromptStore } from '$lib/chat/infrastructure/stores/pending-prompt.store.svelte';
import { isValidAgentRunProfile, roleForAgentMode } from '$shared/providers/providers.api';
import { workstreamReadyForPromptsQuery } from '$shared/repositories/repositories.api';

export { submitPromptCommand };

function submitPromptCommand(request: PromptRequest): void {
	chatRequestsStore.begin(request.requestId);
	void (async () => {
		try {
			await submitPrompt(request);
			chatRequestsStore.accept(request.requestId);
		} catch (error) {
			chatRequestsStore.fail(request.requestId, errorMessage(error, 'Prompt could not be sent'));
		}
	})();
}

async function submitPrompt(input: PromptRequest): Promise<void> {
	const { workstreamId, requestId } = input;
	if (!workstreamId || !input.prompt.trim()) {
		return;
	}
	const role = roleForAgentMode(input.profile.mode);
	if (!isValidAgentRunProfile(input.profile)) throw new Error('Invalid prompt run profile');
	const optimisticRunId = runIdForPromptRequest(requestId);
	const requestedSelection = { model: input.model };
	agentPromptQueue.hydrate(workstreamId);
	const previousQueuedTurn =
		agentPromptQueue.entriesForSession(workstreamId, input.sessionId).at(-1) ?? null;
	const forceFreshSession = shouldForceFreshSessionAfterQueuedTurn({
		requested: input.forceFreshSession,
		previousQueuedTurn,
		nextTurn: { role, ...requestedSelection },
	});
	const turn: PromptTurn = {
		workstreamId,
		sessionId: input.sessionId,
		forceFreshSession,
		role,
		model: input.model,
		profile: input.profile,
		prompt: input.prompt,
		contextFiles: input.contextFiles,
		attachments: input.attachments,
		issueReferences: input.issueReferences,
		transcriptReferences: input.transcriptReferences,
		elementReferences: input.elementReferences,
		...(input.automated === true ? { automated: true } : {}),
	};
	const target = resolveSubmissionSessionTarget({
		workstreamId,
		capturedSessionId: input.sessionId,
		forceFreshSession,
		candidates: chatOccupancy.submissionCandidates(role, requestedSelection),
	});
	if (!workstreamReadyForPromptsQuery.data(workstreamId)) {
		enqueuePromptCommand({ ...turn, sessionId: target.queueTargetSessionId });
		consumeFreshSessionIntent(workstreamId, forceFreshSession);
		return;
	}
	const optimisticSessionId = target.targetSessionId;
	const targetQueue = agentPromptQueue.entriesForSession(workstreamId, target.queueTargetSessionId);
	if (target.targetIsBusy || targetQueue.length > 0) {
		enqueuePromptCommand({ ...turn, sessionId: target.queueTargetSessionId });
		consumeFreshSessionIntent(workstreamId, forceFreshSession);
		if (!target.targetIsBusy) drainPromptQueueCommand(workstreamId);
		return;
	}
	if (optimisticSessionId) {
		pendingPromptStore.set({
			sessionId: optimisticSessionId,
			origin: 'composer',
			runId: optimisticRunId,
			text: input.prompt,
			attachments: input.attachments.map((attachment) => ({ ...attachment })),
			issueReferences: input.issueReferences.map((reference) => ({ ...reference })),
		});
		await tick();
	}
	let sessionId: SessionId;
	try {
		sessionId =
			optimisticSessionId ??
			(await sessionActivation.mint({
				workstreamId,
				role,
				selection: requestedSelection,
				activate: chatRoute.workstreamId === workstreamId,
			}));
	} catch (error) {
		if (optimisticSessionId) pendingPromptStore.clearForSession(optimisticSessionId);
		if (chatRoute.workstreamId === workstreamId) {
			chatSessionStore.bootError = errorMessage(error, 'Agent runtime unavailable');
		}
		throw error;
	}
	consumeFreshSessionIntent(workstreamId, forceFreshSession);
	const targetedTurn: PromptTurn = { ...turn, sessionId, forceFreshSession: false };
	if (!optimisticSessionId) {
		pendingPromptStore.set({
			sessionId,
			origin: 'composer',
			runId: optimisticRunId,
			text: input.prompt,
			attachments: input.attachments.map((attachment) => ({ ...attachment })),
			issueReferences: input.issueReferences.map((reference) => ({ ...reference })),
		});
		await tick();
	}

	agentPromptQueue.hydrate(workstreamId);
	const sessionBusy = chatOccupancy.sessionIsBusy(sessionId);
	const queuedForSession = agentPromptQueue.entriesForSession(workstreamId, sessionId);
	if (sessionBusy || queuedForSession.length > 0) {
		pendingPromptStore.clearForSession(sessionId);
		enqueuePromptCommand(targetedTurn);
		if (!sessionBusy) drainPromptQueueCommand(workstreamId);
		return;
	}

	try {
		await promptDelivery.dispatch({
			workstreamId,
			sessionId,
			prompt: input.prompt,
			role,
			model: input.model,
			profile: input.profile,
			contextFiles: input.contextFiles,
			attachments: input.attachments,
			issueReferences: input.issueReferences,
			transcriptReferences: input.transcriptReferences,
			elementReferences: input.elementReferences,
			...(input.automated === true ? { automated: true } : {}),
			requestId,
		});
	} catch (error) {
		const message = errorMessage(error, 'sendPrompt failed');
		pendingPromptStore.clearForSession(sessionId);
		const failure = classifyPromptDispatchFailure({
			stage: promptDispatchStage(error),
			message,
		});
		if (failure === 'already-running' || failure === 'cancel-race') {
			enqueuePromptCommand(targetedTurn);
			drainPromptQueueCommand(workstreamId);
			return;
		}
		if (failure === 'session-boot' && chatRoute.workstreamId === workstreamId) {
			chatSessionStore.bootError = message;
		}
		throw error;
	}
}

function consumeFreshSessionIntent(workstreamId: string, consumed: boolean): void {
	if (!consumed || chatRoute.workstreamId !== workstreamId) return;
	chatSessionStore.createFreshSessionOnNextPrompt = false;
	chatSessionStore.emptySessionMode = 'setup';
}
