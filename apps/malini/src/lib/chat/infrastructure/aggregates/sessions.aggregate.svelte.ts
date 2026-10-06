import type { AgentEvent, EventEnvelope } from '$lib/chat/domain/events';
import type { RunId } from '$lib/chat/domain/run';
import type { SessionId } from '$lib/chat/domain/session';
import {
	foldSessionStatus,
	foldSessionStatusIncremental,
	isLifecycleKind,
} from '$contract/agent-state-machine';
import type { SessionRecord, SessionState } from '$lib/chat/domain/session-record';
import {
	CanonicalEnvelopeIndex,
	mergeCanonicalEnvelopes,
	type CanonicalEnvelopeIndexStats,
} from '$lib/chat/domain/canonical-envelope-index';

class SessionsAggregate {
	sessionsById: Record<SessionId, SessionRecord> = $state({});
	eventsBySession: Record<SessionId, AgentEvent[]> = $state({});
	currentRunBySession: Record<SessionId, RunId | null> = $state({});
	private envelopesBySession: Record<SessionId, EventEnvelope[]> = {};
	private envelopeIndex = new CanonicalEnvelopeIndex();
	private terminatedRunsBySession = new Map<SessionId, Set<RunId>>();
	private hydratedTranscriptSessions = new Set<SessionId>();

	ensureSession(input: {
		sessionId: SessionId;
		workstreamId: string;
		displayName?: string;
		model: string | null;
		startedAt?: string;
	}): SessionRecord {
		const existing = this.sessionsById[input.sessionId];
		if (existing) {
			if (existing.workstreamId === '_unknown' && input.workstreamId !== '_unknown') {
				const upgraded = {
					...existing,
					workstreamId: input.workstreamId,
					displayName: input.displayName?.trim() || existing.displayName,
					model: input.model ?? existing.model,
				};
				this.sessionsById = { ...this.sessionsById, [input.sessionId]: upgraded };
				return upgraded;
			}
			if (existing.workstreamId !== input.workstreamId && input.workstreamId !== '_unknown') {
				if (import.meta.env.DEV) {
					console.warn('Ignoring agent session workstream mismatch', {
						sessionId: input.sessionId,
						existingWorkstreamId: existing.workstreamId,
						nextWorkstreamId: input.workstreamId,
					});
				}
			}
			return existing;
		}
		const next: SessionRecord = {
			id: input.sessionId,
			workstreamId: input.workstreamId,
			displayName: input.displayName?.trim() || 'Chat',
			model: input.model,
			status: 'idle',
			currentRunId: null,
			lastError: null,
			startedAt: input.startedAt ?? new Date().toISOString(),
		};
		this.sessionsById = {
			...this.sessionsById,
			[input.sessionId]: next,
		};
		this.eventsBySession = {
			...this.eventsBySession,
			[input.sessionId]: this.eventsBySession[input.sessionId] ?? [],
		};
		this.currentRunBySession = {
			...this.currentRunBySession,
			[input.sessionId]: null,
		};
		this.envelopeIndex.reset(input.sessionId, []);
		this.terminatedRunsBySession.set(input.sessionId, new Set());
		return next;
	}

	hydrateSession(input: {
		sessionId: SessionId;
		workstreamId: string;
		displayName?: string;
		model: string | null;
		status: SessionState;
		startedAt: string;
	}): SessionRecord {
		const existing = this.ensureSession(input);
		const hasLiveLifecycleEvidence = (this.envelopesBySession[input.sessionId] ?? []).some(
			({ event }) => isLifecycleKind(event.type),
		);
		const next: SessionRecord = {
			...existing,
			workstreamId: input.workstreamId,
			displayName: input.displayName?.trim() || existing.displayName,
			model: input.model,
			status: hasLiveLifecycleEvidence ? existing.status : input.status,
			startedAt: input.startedAt,
		};
		this.sessionsById = { ...this.sessionsById, [input.sessionId]: next };
		return next;
	}

	setSessionModel(sessionId: SessionId, model: string | null): void {
		const current = this.sessionsById[sessionId];
		if (!current) {
			return;
		}
		this.sessionsById = {
			...this.sessionsById,
			[sessionId]: { ...current, model },
		};
	}

	setSessionDisplayName(sessionId: SessionId, displayName: string): void {
		const current = this.sessionsById[sessionId];
		const normalized = displayName.trim();
		if (!current || !normalized || current.displayName === normalized) return;
		this.sessionsById = {
			...this.sessionsById,
			[sessionId]: { ...current, displayName: normalized },
		};
	}

	resumeRunAfterInteraction(sessionId: SessionId, runId: RunId): void {
		const current = this.sessionsById[sessionId];
		if (!current || current.status !== 'waiting_for_approval' || current.currentRunId !== runId) {
			return;
		}
		this.sessionsById = {
			...this.sessionsById,
			[sessionId]: { ...current, status: 'running' },
		};
	}

	getSession(sessionId: SessionId): SessionRecord | null {
		return this.sessionsById[sessionId] ?? null;
	}

	listSessions(): readonly SessionRecord[] {
		return Object.values(this.sessionsById);
	}

	removeSession(sessionId: SessionId): void {
		if (!this.sessionsById[sessionId]) return;
		const { [sessionId]: _session, ...sessionsById } = this.sessionsById;
		const { [sessionId]: _events, ...eventsBySession } = this.eventsBySession;
		const { [sessionId]: _currentRun, ...currentRunBySession } = this.currentRunBySession;
		this.sessionsById = sessionsById;
		this.eventsBySession = eventsBySession;
		this.currentRunBySession = currentRunBySession;
		const { [sessionId]: _envelopes, ...envelopesBySession } = this.envelopesBySession;
		this.envelopesBySession = envelopesBySession;
		this.envelopeIndex.remove(sessionId);
		this.terminatedRunsBySession.delete(sessionId);
		this.hydratedTranscriptSessions.delete(sessionId);
	}

	reconcileWorkstreamSessions(
		workstreamId: string,
		visibleSessionIds: ReadonlySet<SessionId>,
	): void {
		for (const session of Object.values(this.sessionsById)) {
			if (session.workstreamId === workstreamId && !visibleSessionIds.has(session.id)) {
				this.removeSession(session.id);
			}
		}
	}

	cachedSessionFor(workstreamId: string, requestedSessionId: string | null): SessionId | null {
		if (requestedSessionId) {
			const requested = this.getSession(requestedSessionId);
			if (requested?.workstreamId === workstreamId) return requested.id;
		}
		return this.latestSessionFor(workstreamId);
	}

	latestSessionFor(workstreamId: string): SessionId | null {
		return (
			this.listSessions()
				.filter((session) => session.workstreamId === workstreamId)
				.sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0]?.id ?? null
		);
	}

	listEventsFor(sessionId: SessionId): readonly AgentEvent[] {
		return this.eventsBySession[sessionId] ?? [];
	}

	listEnvelopesFor(sessionId: SessionId): readonly EventEnvelope[] {
		return this.envelopesBySession[sessionId] ?? [];
	}

	markTranscriptHydrated(sessionId: SessionId): void {
		this.hydratedTranscriptSessions.add(sessionId);
	}

	isTranscriptHydrated(sessionId: SessionId): boolean {
		return this.hydratedTranscriptSessions.has(sessionId);
	}

	hydratedTranscriptSessionIds(): readonly SessionId[] {
		return [...this.hydratedTranscriptSessions];
	}

	forgetTranscript(sessionId: SessionId): void {
		if (!this.hydratedTranscriptSessions.has(sessionId) && !this.envelopesBySession[sessionId]) {
			return;
		}
		const { [sessionId]: _envelopes, ...envelopesBySession } = this.envelopesBySession;
		this.envelopesBySession = envelopesBySession;
		if (this.eventsBySession[sessionId]?.length) {
			this.eventsBySession = { ...this.eventsBySession, [sessionId]: [] };
		}
		this.envelopeIndex.remove(sessionId);
		this.hydratedTranscriptSessions.delete(sessionId);
	}

	restorableTranscriptFor(
		sessionId: SessionId,
		workstreamId: string,
	): readonly EventEnvelope[] | null {
		const session = this.getSession(sessionId);
		if (session?.workstreamId !== workstreamId || !this.isTranscriptHydrated(sessionId)) {
			return null;
		}
		return this.listEnvelopesFor(sessionId);
	}

	getCurrentRun(sessionId: SessionId): RunId | null {
		const value = this.currentRunBySession[sessionId];
		return value ?? null;
	}

	applyEvent(env: EventEnvelope): void {
		this.applyEventBatch([env]);
	}

	applyEventBatch(envelopes: readonly EventEnvelope[]): number {
		if (envelopes.length === 0) return 0;

		const additions = new Map<SessionId, EventEnvelope[]>();
		for (const envelope of envelopes) {
			const sessionId = envelope.sessionId;
			if (!this.sessionsById[sessionId]) {
				this.ensureSession({
					sessionId,
					workstreamId: '_unknown',
					model: null,
				});
			}
			const pending = additions.get(sessionId) ?? [];
			pending.push(envelope);
			additions.set(sessionId, pending);
		}

		const nextEnvelopesBySession = { ...this.envelopesBySession };
		const nextEventsBySession = { ...this.eventsBySession };
		const nextSessionsById = { ...this.sessionsById };
		const nextCurrentRunBySession = { ...this.currentRunBySession };
		let lifecycleChanged = false;
		let applied = 0;
		for (const [sessionId, pending] of additions) {
			const existing = nextEnvelopesBySession[sessionId] ?? [];
			const acceptance = this.envelopeIndex.accept(sessionId, existing, pending);
			if (acceptance.accepted.length === 0) continue;
			applied += acceptance.accepted.length;

			const current = nextSessionsById[sessionId];
			if (acceptance.monotonic) {
				existing.push(...acceptance.accepted);
				nextEnvelopesBySession[sessionId] = existing;
				const eventList = nextEventsBySession[sessionId] ?? [];
				eventList.push(...acceptance.accepted.map((envelope) => envelope.event));
				nextEventsBySession[sessionId] = eventList;

				if (current) {
					const terminated = this.terminatedRunsBySession.get(sessionId) ?? new Set<RunId>();
					this.terminatedRunsBySession.set(sessionId, terminated);
					const folded = foldLifecycleIncremental(current, acceptance.accepted, terminated);
					if (folded) {
						nextSessionsById[sessionId] = folded.session;
						nextCurrentRunBySession[sessionId] = folded.currentRunId;
						lifecycleChanged = true;
					}
				}
				continue;
			}

			const canonical = mergeCanonicalEnvelopes(existing, acceptance.accepted);
			nextEnvelopesBySession[sessionId] = canonical;
			nextEventsBySession[sessionId] = canonical.map((envelope) => envelope.event);
			if (current) {
				const folded = foldLifecycle(current, canonical);
				if (folded) {
					nextSessionsById[sessionId] = folded.session;
					nextCurrentRunBySession[sessionId] = folded.currentRunId;
					this.terminatedRunsBySession.set(sessionId, folded.terminatedRunIds);
					lifecycleChanged = true;
				}
			}
		}
		if (applied === 0) return 0;

		this.envelopesBySession = nextEnvelopesBySession;
		this.eventsBySession = nextEventsBySession;
		if (lifecycleChanged) {
			this.sessionsById = nextSessionsById;
			this.currentRunBySession = nextCurrentRunBySession;
		}
		return applied;
	}

	eventIngestionStats(sessionId: SessionId): CanonicalEnvelopeIndexStats {
		return this.envelopeIndex.stats(sessionId);
	}

	reset(): void {
		this.sessionsById = {};
		this.eventsBySession = {};
		this.currentRunBySession = {};
		this.envelopesBySession = {};
		this.envelopeIndex.clear();
		this.terminatedRunsBySession.clear();
		this.hydratedTranscriptSessions.clear();
	}
}

type FoldedLifecycle = {
	session: SessionRecord;
	currentRunId: RunId | null;
	terminatedRunIds: Set<RunId>;
};

function foldLifecycle(
	base: SessionRecord,
	envelopes: readonly EventEnvelope[],
): FoldedLifecycle | null {
	const lifecycle = envelopes.filter(({ event }) => isLifecycleKind(event.type));
	if (lifecycle.length === 0) return null;

	const folded = foldSessionStatus('idle', lifecycle);
	return {
		session: {
			...base,
			status: folded.status,
			currentRunId: folded.currentRunId,
			lastError: folded.lastError,
		},
		currentRunId: folded.currentRunId,
		terminatedRunIds: folded.terminatedRunIds,
	};
}

function foldLifecycleIncremental(
	base: SessionRecord,
	envelopes: readonly EventEnvelope[],
	terminatedRunIds: Set<RunId>,
): FoldedLifecycle | null {
	const folded = foldSessionStatusIncremental(
		{
			status: base.status,
			currentRunId: base.currentRunId,
			lastError: base.lastError,
			terminatedRunIds,
		},
		envelopes,
	);
	if (!folded) return null;
	return {
		session: {
			...base,
			status: folded.status,
			currentRunId: folded.currentRunId,
			lastError: folded.lastError,
		},
		currentRunId: folded.currentRunId,
		terminatedRunIds: folded.terminatedRunIds,
	};
}

export const sessionsAggregate = new SessionsAggregate();
