import type { EventEnvelope } from './events';

export type EphemeralEnvelope = EventEnvelope & { ephemeral: true };
