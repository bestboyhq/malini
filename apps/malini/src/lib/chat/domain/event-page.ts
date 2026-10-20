import type { EventEnvelope } from './events';

export type EventPage = Readonly<{
	envelopes: EventEnvelope[];
	startSeq: number;
	complete: boolean;
	overBudget: boolean;
}>;
