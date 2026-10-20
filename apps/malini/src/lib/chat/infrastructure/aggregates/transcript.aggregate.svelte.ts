import {
	CanonicalEnvelopeIndex,
	mergeCanonicalEnvelopes,
} from '$lib/chat/domain/canonical-envelope-index';
import type { EventEnvelope } from '$lib/chat/domain/events';
import type { SessionId } from '$lib/chat/domain/session';
import type { TranscriptPresentation } from '$lib/chat/domain/transcript-presentation';
import {
	EMPTY_TRANSCRIPT_SUMMARY,
	extendTranscriptSummary,
	summarizeTranscript,
	type TranscriptSummary,
} from '$lib/chat/domain/transcript-summary';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';

const EMPTY_ENVELOPES: readonly EventEnvelope[] = [];

class TranscriptAggregate {
	envelopesBySession: Record<SessionId, readonly EventEnvelope[]> = $state.raw({});
	summaryBySession: Record<SessionId, TranscriptSummary> = $state.raw({});
	readyBySession: Record<SessionId, true> = $state.raw({});
	ownerBySession: Record<SessionId, string> = $state.raw({});
	retainedPresentation: TranscriptPresentation | null = $state.raw(null);
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

	summaryFor(sessionId: SessionId): TranscriptSummary {
		return this.summaryBySession[sessionId] ?? EMPTY_TRANSCRIPT_SUMMARY;
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
		const cached = sessionsAggregate.listEnvelopesFor(sessionId);
		this.#publish(sessionId, cached);
		this.envelopeIndex.reset(sessionId, cached);
	}

	append(batch: readonly EventEnvelope[]): readonly EventEnvelope[] {
		const next = { ...this.envelopesBySession };
		const nextSummaries = { ...this.summaryBySession };
		const accepted: EventEnvelope[] = [];
		let summaryChanged = false;
		const incomingBySession = groupBySession(batch);
		for (const [sessionId, incoming] of incomingBySession) {
			const existing = next[sessionId] ?? EMPTY_ENVELOPES;
			const acceptance = this.envelopeIndex.accept(sessionId, existing, incoming);
			if (acceptance.accepted.length === 0) continue;
			const summary = nextSummaries[sessionId];
			if (acceptance.monotonic) {
				next[sessionId] = existing.concat(acceptance.accepted);
				nextSummaries[sessionId] = extendTranscriptSummary(
					summary ?? summarizeTranscript(existing),
					acceptance.accepted,
				);
			} else {
				const merged = mergeCanonicalEnvelopes(existing, acceptance.accepted);
				next[sessionId] = merged;
				nextSummaries[sessionId] = summarizeTranscript(merged);
			}
			if (nextSummaries[sessionId] !== summary) summaryChanged = true;
			accepted.push(...acceptance.accepted);
		}
		if (accepted.length === 0) return accepted;
		this.envelopesBySession = next;
		if (summaryChanged) this.summaryBySession = nextSummaries;
		return accepted;
	}

	replace(sessionId: SessionId, list: readonly EventEnvelope[]): void {
		const sorted = [...list].sort((left, right) => left.seq - right.seq);
		this.#publish(sessionId, sorted);
		sessionsAggregate.markTranscriptHydrated(sessionId);
		this.markReady(sessionId);
		this.envelopeIndex.reset(sessionId, sorted);
	}

	adoptProjection(sessionId: SessionId, envelopes: readonly EventEnvelope[]): void {
		if (this.envelopesBySession[sessionId]) return;
		this.#publish(sessionId, envelopes);
	}

	#publish(sessionId: SessionId, envelopes: readonly EventEnvelope[]): void {
		this.envelopesBySession = { ...this.envelopesBySession, [sessionId]: envelopes };
		this.summaryBySession = {
			...this.summaryBySession,
			[sessionId]: summarizeTranscript(envelopes),
		};
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
			this.summaryBySession = {};
			this.readyBySession = {};
			this.retainedPresentation = null;
			return null;
		}
		const envelopes = sessionsAggregate.listEnvelopesFor(restoredSessionId);
		this.envelopesBySession = { [restoredSessionId]: envelopes };
		this.summaryBySession = { [restoredSessionId]: summarizeTranscript(envelopes) };
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
		this.#forgetEnvelopes(sessionId);
		const { [sessionId]: _ready, ...readyBySession } = this.readyBySession;
		this.readyBySession = readyBySession;
	}

	#forgetEnvelopes(sessionId: SessionId): void {
		const { [sessionId]: _envelopes, ...envelopesBySession } = this.envelopesBySession;
		const { [sessionId]: _summary, ...summaryBySession } = this.summaryBySession;
		this.envelopesBySession = envelopesBySession;
		this.summaryBySession = summaryBySession;
		this.envelopeIndex.remove(sessionId);
	}

	forgetSession(sessionId: SessionId): void {
		this.#forgetEnvelopes(sessionId);
		const { [sessionId]: _ready, ...readyBySession } = this.readyBySession;
		const { [sessionId]: _owner, ...ownerBySession } = this.ownerBySession;
		this.readyBySession = readyBySession;
		this.ownerBySession = ownerBySession;
		if (this.retainedPresentation?.sessionId === sessionId) this.retainedPresentation = null;
	}

	resetProjections(): void {
		this.envelopesBySession = {};
		this.summaryBySession = {};
		this.readyBySession = {};
		this.envelopeIndex.clear();
	}

	reset(): void {
		this.envelopesBySession = {};
		this.summaryBySession = {};
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
