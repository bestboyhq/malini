import type { SessionId } from '$lib/chat/domain/session';
import type { SessionRecord } from '$lib/chat/domain/session-record';
import type { SubmissionSessionCandidate } from '$lib/chat/domain/submission-session-target';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { transcriptAggregate } from '$lib/chat/infrastructure/aggregates/transcript.aggregate.svelte';
import { readChatModelSnapshot } from '$lib/chat/infrastructure/services/model-preferences.storage';
import { chatModelStore } from '$lib/chat/infrastructure/stores/chat-model.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import {
	sameModelSelection,
	type ModelRole,
	type ModelSelection,
} from '$shared/providers/providers.api';

class ChatOccupancyService {
	sessionIsBusy(sessionId: SessionId): boolean {
		const status = sessionsAggregate.getSession(sessionId)?.status ?? 'idle';
		return (
			status === 'running' ||
			status === 'waiting_for_approval' ||
			chatSessionStore.isDispatchPending(sessionId)
		);
	}

	runBlocker(workstreamId: string, excludeSessionId: SessionId | null): SessionRecord | null {
		let running: SessionRecord | null = null;
		for (const session of sessionsAggregate.listSessions()) {
			if (session.id === excludeSessionId) continue;
			if ((transcriptAggregate.ownerOf(session.id) ?? session.workstreamId) !== workstreamId) {
				continue;
			}
			if (!this.sessionIsBusy(session.id)) continue;
			if (session.status === 'waiting_for_approval') return session;
			running ??= session;
		}
		return running;
	}

	submissionCandidates(
		role: ModelRole,
		selection: ModelSelection,
	): SubmissionSessionCandidate<SessionId>[] {
		return sessionsAggregate.listSessions().map((candidate) => ({
			id: candidate.id,
			workstreamId: transcriptAggregate.ownerOf(candidate.id) ?? candidate.workstreamId,
			startedAt: candidate.startedAt,
			matchesTurn: this.#sessionMatchesTurn(candidate.id, role, selection),
			busy: this.sessionIsBusy(candidate.id),
		}));
	}

	freshSessionRequired(
		sessionId: SessionId | null,
		role: ModelRole,
		selection: ModelSelection,
	): boolean {
		const currentSession = sessionId ? sessionsAggregate.getSession(sessionId) : null;
		const currentSnapshot = sessionId ? readChatModelSnapshot(sessionId) : null;
		return (
			currentSession === null ||
			!sameModelSelection(chatModelStore.selectionForSession(currentSession), selection) ||
			currentSnapshot?.role !== role
		);
	}

	#sessionMatchesTurn(sessionId: SessionId, role: ModelRole, selection: ModelSelection): boolean {
		const record = sessionsAggregate.getSession(sessionId);
		if (!record || !sameModelSelection(chatModelStore.selectionForSession(record), selection)) {
			return false;
		}
		const snapshot = readChatModelSnapshot(sessionId);
		return snapshot?.role === role && sameModelSelection(snapshot.selection, selection);
	}
}

export const chatOccupancy = new ChatOccupancyService();
