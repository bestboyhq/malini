import type { EventEnvelope } from '$lib/chat/domain/events';
import type { SessionId } from '$lib/chat/domain/session';

const NONE: readonly EventEnvelope[] = [];

class ChildRequestsAggregate {
	envelopesBySession: Record<SessionId, readonly EventEnvelope[]> = $state.raw({});

	envelopesFor(sessionId: SessionId): readonly EventEnvelope[] {
		return this.envelopesBySession[sessionId] ?? NONE;
	}

	set(sessionId: SessionId, envelopes: readonly EventEnvelope[]): void {
		this.envelopesBySession = { ...this.envelopesBySession, [sessionId]: envelopes };
	}

	forget(sessionId: SessionId): void {
		if (!Object.hasOwn(this.envelopesBySession, sessionId)) return;
		const { [sessionId]: _forgotten, ...kept } = this.envelopesBySession;
		this.envelopesBySession = kept;
	}
}

export const childRequestsAggregate = new ChildRequestsAggregate();
