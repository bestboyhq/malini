import type { EventEnvelope } from '$lib/chat/domain/events';
import type { SessionId } from '$lib/chat/domain/session';

export type CanonicalEnvelopeAcceptance = {
	accepted: EventEnvelope[];
	monotonic: boolean;
};

export type CanonicalEnvelopeIndexStats = {
	monotonicAccepts: number;
	canonicalRebuilds: number;
};

export class CanonicalEnvelopeIndex {
	#seenBySession = new Map<SessionId, Set<number>>();
	#lastSeqBySession = new Map<SessionId, number>();
	#statsBySession = new Map<SessionId, CanonicalEnvelopeIndexStats>();

	accept(
		sessionId: SessionId,
		existing: readonly EventEnvelope[],
		incoming: readonly EventEnvelope[],
	): CanonicalEnvelopeAcceptance {
		this.#ensureSynchronized(sessionId, existing);
		const seen = this.#seenBySession.get(sessionId)!;
		const accepted: EventEnvelope[] = [];
		for (const envelope of incoming) {
			if (seen.has(envelope.seq)) continue;
			seen.add(envelope.seq);
			accepted.push(envelope);
		}
		accepted.sort((left, right) => left.seq - right.seq);

		const previousLast = this.#lastSeqBySession.get(sessionId) ?? Number.NEGATIVE_INFINITY;
		const first = accepted[0];
		const last = accepted[accepted.length - 1];
		const monotonic = first === undefined || first.seq > previousLast;
		if (first !== undefined && last !== undefined) {
			this.#lastSeqBySession.set(sessionId, Math.max(previousLast, last.seq));
			const stats = this.#stats(sessionId);
			if (monotonic) stats.monotonicAccepts += accepted.length;
			else stats.canonicalRebuilds += 1;
		}
		return { accepted, monotonic };
	}

	reset(sessionId: SessionId, envelopes: readonly EventEnvelope[]): void {
		const seen = new Set<number>();
		let lastSeq = Number.NEGATIVE_INFINITY;
		for (const envelope of envelopes) {
			seen.add(envelope.seq);
			lastSeq = Math.max(lastSeq, envelope.seq);
		}
		this.#seenBySession.set(sessionId, seen);
		this.#lastSeqBySession.set(sessionId, lastSeq);
	}

	remove(sessionId: SessionId): void {
		this.#seenBySession.delete(sessionId);
		this.#lastSeqBySession.delete(sessionId);
		this.#statsBySession.delete(sessionId);
	}

	clear(): void {
		this.#seenBySession.clear();
		this.#lastSeqBySession.clear();
		this.#statsBySession.clear();
	}

	stats(sessionId: SessionId): CanonicalEnvelopeIndexStats {
		return { ...this.#stats(sessionId) };
	}

	#ensureSynchronized(sessionId: SessionId, existing: readonly EventEnvelope[]): void {
		const seen = this.#seenBySession.get(sessionId);
		if (!seen || seen.size !== existing.length) this.reset(sessionId, existing);
	}

	#stats(sessionId: SessionId): CanonicalEnvelopeIndexStats {
		let stats = this.#statsBySession.get(sessionId);
		if (!stats) {
			stats = { monotonicAccepts: 0, canonicalRebuilds: 0 };
			this.#statsBySession.set(sessionId, stats);
		}
		return stats;
	}
}

export function mergeCanonicalEnvelopes(
	existing: readonly EventEnvelope[],
	accepted: readonly EventEnvelope[],
): EventEnvelope[] {
	const merged: EventEnvelope[] = [];
	let existingIndex = 0;
	let acceptedIndex = 0;
	while (existingIndex < existing.length || acceptedIndex < accepted.length) {
		const current = existing[existingIndex];
		const incoming = accepted[acceptedIndex];
		if (current && (!incoming || current.seq < incoming.seq)) {
			merged.push(current);
			existingIndex += 1;
		} else if (!incoming) {
			break;
		} else {
			merged.push(incoming);
			acceptedIndex += 1;
		}
	}
	return merged;
}
