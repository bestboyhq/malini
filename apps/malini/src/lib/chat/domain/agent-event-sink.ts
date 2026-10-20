import type { EventEnvelope } from './events';

export type AgentEventSink = Readonly<{
	appendEnvelopes(batch: readonly EventEnvelope[]): void;
}>;
