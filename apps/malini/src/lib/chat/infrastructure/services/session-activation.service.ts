import { tick } from 'svelte';
import { agentSessionPreactivation } from '$lib/chat/domain/agent-session-preactivation';
import type { EventEnvelope } from '$lib/chat/domain/events';
import type { SessionId } from '$lib/chat/domain/session';
import type { SessionRecord } from '$lib/chat/domain/session-record';
import { settleConcurrentSessionPreparation } from '$lib/chat/domain/session-bootstrap-concurrency';
import type { ChatSessionSummary } from '$lib/chat/domain/chat-session-summary';
import {
	SESSION_SELECTION_SUPERSEDED,
	type SessionSelectionRequest,
	type SupersededSessionSelection,
} from '$lib/chat/domain/session-selection';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { transcriptAggregate } from '$lib/chat/infrastructure/aggregates/transcript.aggregate.svelte';
import { agentEventStream } from '$lib/chat/infrastructure/services/agent-event-stream.service';
import { agentRunner } from '$lib/chat/infrastructure/services/agent-runner.service.svelte';
import { agentSessions } from '$lib/chat/infrastructure/services/agent-sessions.service';
import { chatBootstrapTelemetry } from '$lib/chat/infrastructure/services/chat-bootstrap-telemetry.service';
import { chatRouteSync } from '$lib/chat/infrastructure/services/chat-route-sync.service';
import {
	readChatModelSnapshot,
	readStoredRunProfile,
	writeChatModelSnapshot,
	writeStoredWorkstreamModel,
} from '$lib/chat/infrastructure/services/model-preferences.storage';
import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { streamingStore } from '$lib/chat/infrastructure/stores/streaming.store.svelte';
import {
	isValidAgentModel,
	roleForAgentMode,
	sameModelSelection,
	type AgentRunProfile,
	type ModelRole,
	type ModelSelection,
} from '$shared/providers/providers.api';

class SessionActivationService {
	async refreshSessionTabs(workstreamId: string): Promise<ChatSessionSummary[]> {
		const summaries = await agentSessions.list(workstreamId);
		const visibleSessionIds = new Set<SessionId>(summaries.map((summary) => summary.id));
		sessionsAggregate.reconcileWorkstreamSessions(workstreamId, visibleSessionIds);
		for (const summary of summaries) {
			transcriptAggregate.rememberOwner(summary.id, workstreamId);
			sessionsAggregate.hydrateSession({
				sessionId: summary.id,
				workstreamId,
				displayName: summary.displayName,
				model: summary.model,
				status: summary.status,
				startedAt: summary.startedAt,
			});
			this.ensureRecord(summary.id, workstreamId);
		}
		return summaries;
	}

	ensureRecord(sessionId: SessionId, workstreamId?: string): void {
		const owner =
			workstreamId ??
			transcriptAggregate.ownerOf(sessionId) ??
			(sessionId === chatSessionStore.sessionId ? chatRoute.workstreamId : '_unknown');
		if (owner !== '_unknown') {
			transcriptAggregate.rememberOwner(sessionId, owner);
		}
		if (!sessionsAggregate.getSession(sessionId)) {
			sessionsAggregate.ensureSession({
				sessionId,
				workstreamId: owner,
				model: chatModelStore.model,
			});
		}
		transcriptAggregate.ensureProjection(sessionId);
	}

	replaceEnvelopes(
		sessionId: SessionId,
		list: readonly EventEnvelope[],
		workstreamId = chatRoute.workstreamId,
	): void {
		transcriptAggregate.rememberOwner(sessionId, workstreamId);
		transcriptAggregate.replace(sessionId, list);
		sessionsAggregate.ensureSession({
			sessionId,
			workstreamId,
			model: chatModelStore.model,
		});
	}

	publishHydrated(sessionId: SessionId): void {
		sessionsAggregate.markTranscriptHydrated(sessionId);
		transcriptAggregate.markReady(sessionId);
	}

	async hydrate(sessionId: SessionId, options: { publishReadiness?: boolean } = {}): Promise<void> {
		await agentEventStream.hydrate(sessionId);
		if (options.publishReadiness === false) return;
		this.publishHydrated(sessionId);
	}

	activeRunOwner(): { workstreamId: string; sessionId: SessionId } | null {
		const sessionId = chatSessionStore.sessionId;
		if (!sessionId) return null;
		const workstreamId =
			transcriptAggregate.ownerOf(sessionId) ??
			sessionsAggregate.getSession(sessionId)?.workstreamId;
		return workstreamId ? { workstreamId, sessionId } : null;
	}

	sessionHasConversation(sessionId: SessionId): boolean {
		return transcriptAggregate
			.envelopesFor(sessionId)
			.some(
				(envelope) =>
					envelope.event.type === 'user.message' ||
					envelope.event.type === 'assistant.message' ||
					envelope.event.type === 'run.started',
			);
	}

	commitSessionlessPresentation(workstreamId: string, selection?: SessionSelectionRequest): void {
		if (
			!chatRoute.isCurrentWorkstream(workstreamId) ||
			chatSessionStore.sessionId !== null ||
			(chatSessionStore.emptySessionMode !== 'fresh' &&
				!chatSessionStore.createFreshSessionOnNextPrompt) ||
			(selection && !chatSessionStore.isCurrentSelection(selection))
		) {
			return;
		}
		transcriptAggregate.retainedPresentation = null;
	}

	async awaitCurrentSelection<T>(
		request: SessionSelectionRequest,
		operation: Promise<T>,
	): Promise<T | SupersededSessionSelection> {
		try {
			const result = await operation;
			return chatSessionStore.isCurrentSelection(request) ? result : SESSION_SELECTION_SUPERSEDED;
		} catch (error) {
			if (!chatSessionStore.isCurrentSelection(request)) return SESSION_SELECTION_SUPERSEDED;
			throw error;
		}
	}

	activateFromRoute(sessionId: SessionId, workstreamId: string): Promise<boolean> {
		const selection = chatSessionStore.beginSelection(workstreamId, sessionId, true);
		return this.activate(sessionId, workstreamId, true, selection).finally(() => {
			chatSessionStore.finishSelection(selection);
		});
	}

	#selectionFor(
		sessionId: SessionId,
		workstreamId: string,
		record: SessionRecord,
	): Readonly<{
		selection: ModelSelection;
		role: ModelRole;
		profile: AgentRunProfile;
		remembered: boolean;
	}> {
		const nextSelection = chatModelStore.selectionForSession(record);
		const storedProfile = readStoredRunProfile(workstreamId);
		const snapshot = readChatModelSnapshot(sessionId);
		const remembered = snapshot !== null && sameModelSelection(snapshot.selection, nextSelection);
		const inferredRole: ModelRole = sameModelSelection(
			nextSelection,
			chatModelStore.workstreamPreferences.planning,
		)
			? 'planning'
			: sameModelSelection(nextSelection, chatModelStore.workstreamPreferences.implementation)
				? 'implementation'
				: roleForAgentMode(storedProfile.mode);
		const role = snapshot && remembered ? snapshot.role : inferredRole;
		return {
			selection: nextSelection,
			role,
			profile: {
				mode: role === 'planning' ? 'plan' : 'agent',
				effort: storedProfile.effort,
				access: storedProfile.access,
			},
			remembered,
		};
	}

	#previewSelection(sessionId: SessionId, workstreamId: string, record: SessionRecord): void {
		const next = this.#selectionFor(sessionId, workstreamId, record);
		chatModelStore.preview = { sessionId, model: next.selection.model, profile: next.profile };
	}

	#commitSelection(
		sessionId: SessionId,
		workstreamId: string,
		record: SessionRecord,
		request: SessionSelectionRequest,
	): void {
		chatModelStore.preview = null;
		if (chatModelStore.userChoices === request.userChoices) {
			const next = this.#selectionFor(sessionId, workstreamId, record);
			if (!next.remembered) {
				writeChatModelSnapshot(sessionId, { role: next.role, selection: next.selection });
			}
			chatModelStore.model = next.selection.model;
			chatModelStore.profile = next.profile;
			writeStoredWorkstreamModel(workstreamId, next.selection.model);
			chatSessionStore.createFreshSessionOnNextPrompt = false;
		}
		chatSessionStore.sessionId = sessionId;
		chatSessionStore.emptySessionMode = 'setup';
		chatSessionStore.bootError = null;
	}

	async activate(
		sessionId: SessionId,
		workstreamId = chatRoute.workstreamId,
		syncUrl = true,
		selection?: SessionSelectionRequest,
	): Promise<boolean> {
		if (!workstreamId) return false;
		if (!selection && chatSessionStore.activatingSessionId === sessionId) return false;
		const request = selection ?? chatSessionStore.beginSelection(workstreamId, sessionId);
		const ownsSelection = !selection;
		if (!chatSessionStore.isCurrentSelection(request)) return false;
		chatSessionStore.activatingSessionId = sessionId;
		try {
			let record = sessionsAggregate.getSession(sessionId);
			if (!record || record.workstreamId !== workstreamId) {
				const refreshed = await this.awaitCurrentSelection(
					request,
					chatBootstrapTelemetry.measureSessionListFetch(workstreamId, () =>
						this.refreshSessionTabs(workstreamId),
					),
				);
				if (refreshed === SESSION_SELECTION_SUPERSEDED) return false;
				record = sessionsAggregate.getSession(sessionId);
			}
			if (!record || record.workstreamId !== workstreamId) {
				throw new Error('This agent session does not belong to the active workstream');
			}

			transcriptAggregate.rememberOwner(sessionId, workstreamId);
			this.ensureRecord(sessionId, workstreamId);
			transcriptAggregate.restoreCached(workstreamId, sessionId);
			if (transcriptAggregate.isReady(sessionId)) {
				if (syncUrl && chatRoute.readSessionParam() !== sessionId) {
					const routed = await this.awaitCurrentSelection(
						request,
						chatRouteSync.syncSessionUrl(sessionId, workstreamId),
					);
					if (routed === SESSION_SELECTION_SUPERSEDED) return false;
				}
				this.#commitSelection(sessionId, workstreamId, record, request);
			} else {
				this.#previewSelection(sessionId, workstreamId, record);
			}
			transcriptAggregate.deferReadiness(sessionId);
			try {
				const preparationTasks: Array<() => Promise<void | SupersededSessionSelection>> = [
					() =>
						this.awaitCurrentSelection(
							request,
							chatBootstrapTelemetry.measurePhase(workstreamId, 'Activating workstream chat', () =>
								agentSessionPreactivation.activateForeground(sessionId, (activatedSessionId) =>
									agentSessions.activate(activatedSessionId),
								),
							),
						),
					() =>
						this.awaitCurrentSelection(
							request,
							chatBootstrapTelemetry.measurePhase(
								workstreamId,
								'Restoring conversation history',
								() => this.hydrate(sessionId, { publishReadiness: false }),
							),
						),
				];
				if (syncUrl) {
					preparationTasks.push(() =>
						this.awaitCurrentSelection(
							request,
							chatBootstrapTelemetry.measurePhase(workstreamId, 'Synchronizing chat route', () =>
								chatRouteSync.syncSessionUrl(sessionId),
							),
						),
					);
				}
				const preparation = await settleConcurrentSessionPreparation(preparationTasks);
				if (
					preparation.includes(SESSION_SELECTION_SUPERSEDED) ||
					!chatSessionStore.isCurrentSelection(request)
				) {
					return false;
				}
				this.publishHydrated(sessionId);
			} finally {
				transcriptAggregate.releaseReadiness(sessionId);
			}

			this.#commitSelection(sessionId, workstreamId, record, request);
			return true;
		} finally {
			if (chatModelStore.preview?.sessionId === sessionId) chatModelStore.preview = null;
			if (ownsSelection) chatSessionStore.finishSelection(request);
		}
	}

	async mint(input: {
		workstreamId: string;
		role: ModelRole;
		selection: ModelSelection;
		activate: boolean;
	}): Promise<SessionId> {
		const { workstreamId, role, selection } = input;
		if (!workstreamId) {
			throw new Error('workstreamId missing in route params');
		}
		if (!isValidAgentModel(selection.model)) {
			throw new Error(`Unsupported ${selection.model} model`);
		}
		const previousSessionId =
			input.activate && chatRoute.workstreamId === workstreamId ? chatSessionStore.sessionId : null;
		const previousSessionWasEmpty =
			previousSessionId !== null && !this.sessionHasConversation(previousSessionId);
		const sessionId = await agentRunner.startSession({
			workstreamId,
			model: selection.model,
		});
		transcriptAggregate.rememberOwner(sessionId, workstreamId);
		sessionsAggregate.ensureSession({
			sessionId,
			workstreamId,
			model: selection.model,
		});
		writeChatModelSnapshot(sessionId, { role, selection });
		if (previousSessionWasEmpty && previousSessionId && previousSessionId !== sessionId) {
			try {
				await agentSessions.archive(previousSessionId);
				sessionsAggregate.removeSession(previousSessionId);
				streamingStore.clearRun(previousSessionId);
			} catch {}
		}
		await this.refreshSessionTabs(workstreamId);
		this.ensureRecord(sessionId, workstreamId);
		this.replaceEnvelopes(sessionId, [], workstreamId);
		if (previousSessionId) {
			streamingStore.clearRun(previousSessionId);
		}
		streamingStore.clearRun(sessionId);
		if (input.activate && chatRoute.isCurrentWorkstream(workstreamId)) {
			chatSessionStore.suppressRouteActivation = true;
			try {
				chatModelStore.model = selection.model;
				chatModelStore.profile = {
					mode: role === 'planning' ? 'plan' : 'agent',
					effort: chatModelStore.profile.effort,
					access: chatModelStore.profile.access,
				};
				chatSessionStore.sessionId = sessionId;
				chatSessionStore.createFreshSessionOnNextPrompt = false;
				chatSessionStore.emptySessionMode = 'setup';
				chatSessionStore.freshReturnSessionId = null;
				await chatRouteSync.syncSessionUrl(sessionId, workstreamId);
				await tick();
			} finally {
				chatSessionStore.suppressRouteActivation = false;
			}
		}
		return sessionId;
	}
}

export const sessionActivation = new SessionActivationService();
