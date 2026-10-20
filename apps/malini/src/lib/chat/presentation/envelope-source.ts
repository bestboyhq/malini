import type { EventEnvelope } from '$lib/chat/domain/events';

export type EnvelopeSource = Readonly<{
	envelopes: readonly EventEnvelope[];
	length: number;
	first: EventEnvelope | undefined;
	last: EventEnvelope | undefined;
}>;

export type EnvelopeSourceChange =
	| Readonly<{ kind: 'unchanged' }>
	| Readonly<{ kind: 'append'; from: number }>
	| Readonly<{ kind: 'prepend'; count: number }>
	| Readonly<{ kind: 'rebuild' }>;

export const EMPTY_ENVELOPE_SOURCE: EnvelopeSource = Object.freeze({
	envelopes: [],
	length: 0,
	first: undefined,
	last: undefined,
});

export function envelopeSource(envelopes: readonly EventEnvelope[]): EnvelopeSource {
	return { envelopes, length: envelopes.length, first: envelopes[0], last: envelopes.at(-1) };
}

export function envelopeSourceChange(
	previous: EnvelopeSource,
	next: readonly EventEnvelope[],
): EnvelopeSourceChange {
	const length = previous.length;
	if (length === 0) return next.length === 0 ? { kind: 'unchanged' } : { kind: 'append', from: 0 };
	if (next.length >= length && next[0] === previous.first && next[length - 1] === previous.last) {
		return next.length === length ? { kind: 'unchanged' } : { kind: 'append', from: length };
	}
	const count = next.length - length;
	if (count > 0 && next[count] === previous.first && next[next.length - 1] === previous.last) {
		return { kind: 'prepend', count };
	}
	return { kind: 'rebuild' };
}
