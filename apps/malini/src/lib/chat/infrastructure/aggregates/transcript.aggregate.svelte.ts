import {
	CanonicalEnvelopeIndex,
	mergeCanonicalEnvelopes,
} from '$lib/chat/domain/canonical-envelope-index';
import type { EventEnvelope } from '$lib/chat/domain/events';
import type { SessionId } from '$lib/chat/domain/session';
import type { TranscriptPresentation } from '$lib/chat/domain/transcript-presentation';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

const EMPTY_ENVELOPES: readonly EventEnvelope[] = [];

class TranscriptAggregate {
	envelopesBySession: Record<SessionId, EventEnvelope[]> = $state({});
	readyBySession: Record<SessionId, true> = $state({});
	ownerBySession: Record<SessionId, string> = $state({});
	retainedPresentation: TranscriptPresentation | null = $state(null);
	readonly targetPresentation: TranscriptPresentation | null = $derived.by(() => {
		const workstreamId = chatRoute.workstreamId;
		const sessionId = chatRoute.requestedSessionId ?? chatSessionStore.sessionId;
		if (!sessionId) return null;
		const owner =
			this.ownerBySession[sessionId] ?? sessionsAggregate.getSession(sessionId)?.workstreamId;
		if (
			owner !== workstreamId ||
			this.readyBySession[sessionId] !== true ||
			!Object.hasOwn(this.envelopesBySession, sessionId)
		) {
			return null;
		}
		return { workstreamId, sessionId };
	});
	private readonly deferredReadiness = new Map<SessionId, number>();
	private readonly envelopeIndex = new CanonicalEnvelopeIndex();

	envelopesFor(sessionId: SessionId): readonly EventEnvelope[] {
		return this.envelopesBySession[sessionId] ?? EMPTY_ENVELOPES;
	}

	hasProjection(sessionId: SessionId): boolean {
		return Object.hasOwn(this.envelopesBySession, sessionId);
	}

	ownerOf(sessionId: SessionId): string | undefined {
		return this.ownerBySession[sessionId];
	}

	rememberOwner(sessionId: SessionId, workstreamId: string): void {
		if (this.ownerBySession[sessionId] === workstreamId) return;
		this.ownerBySession = { ...this.ownerBySession, [sessionId]: workstreamId };
	}

	isReady(sessionId: SessionId): boolean {
		return this.readyBySession[sessionId] === true;
	}

	markReady(sessionId: SessionId): void {
		if (this.readyBySession[sessionId]) return;
		this.readyBySession = { ...this.readyBySession, [sessionId]: true };
	}

	deferReadiness(sessionId: SessionId): void {
		this.deferredReadiness.set(sessionId, (this.deferredReadiness.get(sessionId) ?? 0) + 1);
	}

	releaseReadiness(sessionId: SessionId): void {
		const remaining = (this.deferredReadiness.get(sessionId) ?? 1) - 1;
		if (remaining <= 0) {
			this.deferredReadiness.delete(sessionId);
			return;
		}
		this.deferredReadiness.set(sessionId, remaining);
	}

	isReadinessDeferred(sessionId: SessionId): boolean {
		return this.deferredReadiness.has(sessionId);
	}

	ensureProjection(sessionId: SessionId): void {
		if (this.envelopesBySession[sessionId]) return;
		const cached = [...sessionsAggregate.listEnvelopesFor(sessionId)];
		this.envelopesBySession = { ...this.envelopesBySession, [sessionId]: cached };
		this.envelopeIndex.reset(sessionId, cached);
	}

	append(batch: readonly EventEnvelope[]): readonly EventEnvelope[] {
		const next = { ...this.envelopesBySession };
		const accepted: EventEnvelope[] = [];
		const incomingBySession = groupBySession(batch);
		for (const [sessionId, incoming] of incomingBySession) {
			const existing = next[sessionId] ?? [];
			const acceptance = this.envelopeIndex.accept(sessionId, existing, incoming);
			if (acceptance.accepted.length === 0) continue;
			if (acceptance.monotonic) {
				existing.push(...acceptance.accepted);
				next[sessionId] = existing;
			} else {
				next[sessionId] = mergeCanonicalEnvelopes(existing, acceptance.accepted);
			}
			accepted.push(...acceptance.accepted);
		}
		if (accepted.length === 0) return accepted;
		this.envelopesBySession = next;
		return accepted;
	}

	replace(sessionId: SessionId, list: readonly EventEnvelope[]): void {
		const sorted = [...list].sort((left, right) => left.seq - right.seq);
		this.envelopesBySession = { ...this.envelopesBySession, [sessionId]: [...sorted] };
		sessionsAggregate.markTranscriptHydrated(sessionId);
		this.markReady(sessionId);
		this.envelopeIndex.reset(sessionId, sorted);
	}

	adoptProjection(sessionId: SessionId, envelopes: readonly EventEnvelope[]): void {
		if (this.envelopesBySession[sessionId]) return;
		this.envelopesBySession = { ...this.envelopesBySession, [sessionId]: [...envelopes] };
	}

	restoreCached(workstreamId: string, requestedSessionId: string | null): SessionId | null {
		const cachedSessionId = requestedSessionId
			? sessionsAggregate.getSession(requestedSessionId)?.workstreamId === workstreamId
				? requestedSessionId
				: null
			: sessionsAggregate.cachedSessionFor(workstreamId, null);
		if (!cachedSessionId) return null;

		const cached = sessionsAggregate.restorableTranscriptFor(cachedSessionId, workstreamId);
		if (cached === null) return cachedSessionId;

		this.rememberOwner(cachedSessionId, workstreamId);
		this.adoptProjection(cachedSessionId, cached);
		this.markReady(cachedSessionId);
		return cachedSessionId;
	}

	seedOwnersFromSessions(): void {
		this.ownerBySession = Object.fromEntries(
			sessionsAggregate
				.listSessions()
				.map((session): [SessionId, string] => [session.id, session.workstreamId]),
		);
	}

	seedProjection(workstreamId: string, requestedSessionId: string | null): SessionId | null {
		const restoredSessionId = sessionsAggregate.cachedSessionFor(workstreamId, requestedSessionId);
		if (!restoredSessionId) {
			this.envelopesBySession = {};
			this.readyBySession = {};
			this.retainedPresentation = null;
			return null;
		}
		const envelopes = [...sessionsAggregate.listEnvelopesFor(restoredSessionId)];
		this.envelopesBySession = { [restoredSessionId]: envelopes };
		this.readyBySession = {};
		if (envelopes.length > 0 || sessionsAggregate.isTranscriptHydrated(restoredSessionId)) {
			this.markReady(restoredSessionId);
		}
		this.retainedPresentation = { workstreamId, sessionId: restoredSessionId };
		return restoredSessionId;
	}

	dropProjection(sessionId: SessionId): void {
		if (!Object.hasOwn(this.envelopesBySession, sessionId) && !this.readyBySession[sessionId])
			return;
		const { [sessionId]: _envelopes, ...envelopesBySession } = this.envelopesBySession;
		const { [sessionId]: _ready, ...readyBySession } = this.readyBySession;
		this.envelopesBySession = envelopesBySession;
		this.readyBySession = readyBySession;
		this.envelopeIndex.remove(sessionId);
	}

	forgetSession(sessionId: SessionId): void {
		const { [sessionId]: _envelopes, ...envelopesBySession } = this.envelopesBySession;
		const { [sessionId]: _ready, ...readyBySession } = this.readyBySession;
		const { [sessionId]: _owner, ...ownerBySession } = this.ownerBySession;
		this.envelopesBySession = envelopesBySession;
		this.readyBySession = readyBySession;
		this.ownerBySession = ownerBySession;
		this.envelopeIndex.remove(sessionId);
		if (this.retainedPresentation?.sessionId === sessionId) this.retainedPresentation = null;
	}

	resetProjections(): void {
		this.envelopesBySession = {};
		this.readyBySession = {};
		this.envelopeIndex.clear();
	}

	reset(): void {
		this.envelopesBySession = {};
		this.readyBySession = {};
		this.ownerBySession = {};
		this.retainedPresentation = null;
		this.deferredReadiness.clear();
		this.envelopeIndex.clear();
	}
}

function groupBySession(batch: readonly EventEnvelope[]): ReadonlyMap<SessionId, EventEnvelope[]> {
	const grouped = new Map<SessionId, EventEnvelope[]>();
	for (const envelope of batch) {
		const incoming = grouped.get(envelope.sessionId) ?? [];
		incoming.push(envelope);
		grouped.set(envelope.sessionId, incoming);
	}
	return grouped;
}

export const transcriptAggregate = new TranscriptAggregate();
