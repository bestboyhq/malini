import type { EmptySessionMode } from '$lib/chat/domain/empty-session-mode';
import type { SessionId } from '$lib/chat/domain/session';
import type { SessionSelectionRequest } from '$lib/chat/domain/session-selection';
import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';

class ChatSessionStore {
	sessionId: SessionId | null = $state(null);
	activatingSessionId: SessionId | null = $state(null);
	bootError: string | null = $state(null);
	emptySessionMode: EmptySessionMode = $state('setup');
	createFreshSessionOnNextPrompt: boolean = $state(false);
	retryingSession: boolean = $state(false);
	resettingRuns: boolean = $state(false);
	bootingWorkstreamId: string | null = $state(null);
	bootstrappedFor: string | null = $state(null);
	projectedFor: string | null = $state(null);
	dispatchPendingBySession: Record<SessionId, boolean> = $state({});
	suppressRouteActivation = false;
	activationFollowsRoute = false;
	selectionGeneration = 0;
	bootstrapSeq = 0;

	beginSelection(
		workstreamId: string,
		targetSessionId: SessionId | null,
		followsRoute = false,
	): SessionSelectionRequest {
		const request = {
			generation: ++this.selectionGeneration,
			workstreamId,
			userChoices: chatModelStore.userChoices,
		};
		this.activationFollowsRoute = followsRoute;
		this.activatingSessionId = targetSessionId;
		return request;
	}

	isCurrentSelection(request: SessionSelectionRequest): boolean {
		return (
			request.generation === this.selectionGeneration &&
			chatRoute.isCurrentWorkstream(request.workstreamId)
		);
	}

	finishSelection(request: SessionSelectionRequest): void {
		if (request.generation === this.selectionGeneration) {
			this.activatingSessionId = null;
		}
	}

	setDispatchPending(sessionId: SessionId, pending: boolean): void {
		if ((this.dispatchPendingBySession[sessionId] ?? false) === pending) return;
		this.dispatchPendingBySession = { ...this.dispatchPendingBySession, [sessionId]: pending };
	}

	isDispatchPending(sessionId: SessionId): boolean {
		return this.dispatchPendingBySession[sessionId] ?? false;
	}

	isPreparing(workstreamId: string): boolean {
		return (
			Boolean(workstreamId) &&
			(this.bootstrappedFor !== workstreamId || this.bootingWorkstreamId === workstreamId)
		);
	}

	nextBootstrapSeq(): number {
		return ++this.bootstrapSeq;
	}

	abandonBootstrap(): void {
		this.bootstrapSeq += 1;
	}

	reset(): void {
		this.bootstrapSeq += 1;
		this.selectionGeneration += 1;
		this.sessionId = null;
		this.activatingSessionId = null;
		this.bootError = null;
		this.emptySessionMode = 'setup';
		this.createFreshSessionOnNextPrompt = false;
		this.retryingSession = false;
		this.resettingRuns = false;
		this.bootingWorkstreamId = null;
		this.bootstrappedFor = null;
		this.projectedFor = null;
		this.dispatchPendingBySession = {};
		this.suppressRouteActivation = false;
		this.activationFollowsRoute = false;
	}
}

export const chatSessionStore = new ChatSessionStore();
