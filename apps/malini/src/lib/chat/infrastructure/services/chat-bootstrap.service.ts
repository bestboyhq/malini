import { errorMessage } from '$lib/chat/domain/error-message';
import type { SessionId } from '$lib/chat/domain/session';
import { SESSION_SELECTION_SUPERSEDED } from '$lib/chat/domain/session-selection';
import { agentPromptQueue } from '$lib/chat/infrastructure/aggregates/prompt-queue.aggregate.svelte';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { chatBootstrapTelemetry } from '$lib/chat/infrastructure/services/chat-bootstrap-telemetry.service';
import { chatRouteSync } from '$lib/chat/infrastructure/services/chat-route-sync.service';
import {
	readStoredRunProfile,
	hasStoredRunProfile,
} from '$lib/chat/infrastructure/services/model-preferences.storage';
import { promptDelivery } from '$lib/chat/infrastructure/services/prompt-delivery.service';
import { sessionActivation } from '$lib/chat/infrastructure/services/session-activation.service';
import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { roleForAgentMode, selectionForRole } from '$shared/providers/providers.api';

class ChatBootstrapService {
	readonly #running = new Map<string, Promise<void>>();

	async settled(workstreamId: string): Promise<void> {
		const running = this.#running.get(workstreamId);
		if (!running) return;
		await running;
		await this.settled(workstreamId);
	}

	async run(workstreamId: string, seq: number, exactSessionId?: SessionId): Promise<void> {
		const running = this.#bootstrap(workstreamId, seq, exactSessionId);
		this.#running.set(workstreamId, running);
		try {
			await running;
		} finally {
			if (this.#running.get(workstreamId) === running) this.#running.delete(workstreamId);
		}
	}

	async #bootstrap(workstreamId: string, seq: number, exactSessionId?: SessionId): Promise<void> {
		if (!workstreamId) return;
		const rememberedModels = chatModelStore.loadRememberedModels();
		const hadStoredProfile = hasStoredRunProfile(workstreamId);
		const storedProfile = readStoredRunProfile(workstreamId);
		const nextRole = roleForAgentMode(storedProfile.mode);
		const nextSelection = selectionForRole(rememberedModels, nextRole);
		if (seq !== chatSessionStore.bootstrapSeq || chatRoute.workstreamId !== workstreamId) {
			return;
		}
		const requestedSessionId =
			exactSessionId ??
			chatRoute.readSessionParam() ??
			sessionsAggregate.cachedSessionFor(workstreamId, null);
		const selection = chatSessionStore.beginSelection(workstreamId, requestedSessionId);
		chatModelStore.model = nextSelection.model;
		chatModelStore.profile = {
			mode: nextRole === 'planning' ? 'plan' : 'agent',
			effort: storedProfile.effort,
			access: storedProfile.access,
		};
		try {
			const refreshed = await sessionActivation.awaitCurrentSelection(
				selection,
				chatBootstrapTelemetry.measureSessionListFetch(workstreamId, () =>
					sessionActivation.refreshSessionTabs(workstreamId),
				),
			);
			if (refreshed === SESSION_SELECTION_SUPERSEDED || seq !== chatSessionStore.bootstrapSeq) {
				return;
			}
			const requested = requestedSessionId
				? sessionsAggregate.getSession(requestedSessionId)
				: null;
			let sessionId: SessionId | null;
			if (requested?.workstreamId === workstreamId) {
				const activated = await sessionActivation.activate(
					requested.id,
					workstreamId,
					true,
					selection,
				);
				if (!activated) return;
				sessionId = requested.id;
			} else if (exactSessionId) {
				throw new Error('The restored agent session is no longer available');
			} else if (refreshed[0]) {
				const activated = await sessionActivation.activate(
					refreshed[0].id,
					workstreamId,
					true,
					selection,
				);
				if (!activated) return;
				sessionId = refreshed[0].id;
			} else {
				chatSessionStore.sessionId = null;
				chatSessionStore.createFreshSessionOnNextPrompt = true;
				chatSessionStore.emptySessionMode = 'setup';
				await chatRouteSync.clearSessionUrl();
				sessionActivation.commitSessionlessPresentation(workstreamId, selection);
				chatSessionStore.bootError = null;
				agentPromptQueue.hydrate(workstreamId);
				if (agentPromptQueue.countFor(workstreamId) > 0) promptDelivery.scheduleDrain(workstreamId);
				return;
			}
			if (
				!sessionId ||
				seq !== chatSessionStore.bootstrapSeq ||
				!chatSessionStore.isCurrentSelection(selection)
			) {
				return;
			}
			if (
				hadStoredProfile &&
				chatModelStore.userChoices === selection.userChoices &&
				roleForAgentMode(chatModelStore.profile.mode) !== nextRole
			) {
				chatModelStore.model = nextSelection.model;
				chatModelStore.profile = {
					mode: nextRole === 'planning' ? 'plan' : 'agent',
					effort: storedProfile.effort,
					access: storedProfile.access,
				};
				chatSessionStore.createFreshSessionOnNextPrompt = true;
			}
			chatSessionStore.bootError = null;
			promptDelivery.scheduleDrain(workstreamId);
		} catch (error) {
			if (
				seq !== chatSessionStore.bootstrapSeq ||
				chatRoute.workstreamId !== workstreamId ||
				!chatSessionStore.isCurrentSelection(selection)
			) {
				return;
			}
			chatSessionStore.bootError = errorMessage(error, 'Agent runtime unavailable');
		} finally {
			chatSessionStore.finishSelection(selection);
			if (seq === chatSessionStore.bootstrapSeq && chatRoute.workstreamId === workstreamId) {
				chatSessionStore.bootingWorkstreamId = null;
			}
		}
	}
}

export const chatBootstrap = new ChatBootstrapService();
