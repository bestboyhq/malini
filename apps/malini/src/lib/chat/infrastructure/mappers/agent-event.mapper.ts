import type { AgentEventEnvelope as RawAgentEventEnvelope } from '$contract/agent';
import type { EphemeralEnvelope } from '$lib/chat/domain/ephemeral-envelope';
import type { AgentEvent, EventEnvelope } from '$lib/chat/domain/events';

export class AgentEventMapper {
	static fromRawList(raws: readonly RawAgentEventEnvelope[]): EventEnvelope[] {
		return raws.map((raw) => this.fromRaw(raw));
	}

	static fromRaw(raw: RawAgentEventEnvelope): EventEnvelope {
		return {
			sessionId: raw.sessionId,
			runId: raw.runId,
			seq: raw.seq,
			event: isAgentEvent(raw.event) ? raw.event : { type: 'unknown', raw: raw.event },
		};
	}

	static fromLive(payload: unknown): EventEnvelope | null {
		if (!isRecord(payload)) return null;
		const { sessionId, runId, seq, event } = payload;
		if (typeof sessionId !== 'string' || typeof runId !== 'string' || typeof seq !== 'number') {
			return null;
		}
		const envelope: EventEnvelope = {
			sessionId,
			runId,
			seq,
			event: isAgentEvent(event) ? event : { type: 'unknown', raw: event },
		};
		if (payload.ephemeral !== true) return envelope;
		const ephemeral: EphemeralEnvelope = { ...envelope, ephemeral: true };
		return ephemeral;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isAgentEvent(value: unknown): value is AgentEvent {
	return isRecord(value) && typeof value.type === 'string';
}
