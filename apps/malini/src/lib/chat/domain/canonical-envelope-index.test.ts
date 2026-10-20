import { describe, expect, it } from 'vitest';
import type { EventEnvelope } from '$lib/chat/domain/events';
import { CanonicalEnvelopeIndex, mergeCanonicalEnvelopes } from './canonical-envelope-index';

function envelope(seq: number): EventEnvelope {
	return {
		sessionId: 'session-1',
		runId: 'run-1',
		seq,
		event: { type: 'assistant.message', runId: 'run-1', text: `${seq}` },
	};
}

describe('CanonicalEnvelopeIndex', () => {
	it('accepts thousands of one-by-one live envelopes without canonical rebuilds', () => {
		const index = new CanonicalEnvelopeIndex();
		const existing: EventEnvelope[] = [];
		for (let seq = 1; seq <= 5_000; seq += 1) {
			const result = index.accept('session-1', existing, [envelope(seq)]);
			expect(result.monotonic).toBe(true);
			existing.push(...result.accepted);
		}
		expect(index.stats('session-1')).toEqual({
			monotonicAccepts: 5_000,
			canonicalRebuilds: 0,
		});
	});

	it('dedupes by seq and requests one merge for a late lower-seq batch', () => {
		const index = new CanonicalEnvelopeIndex();
		const existing = [envelope(10), envelope(30)];
		index.reset('session-1', existing);
		const result = index.accept('session-1', existing, [envelope(20), envelope(30)]);

		expect(result.monotonic).toBe(false);
		expect(mergeCanonicalEnvelopes(existing, result.accepted).map(({ seq }) => seq)).toEqual([
			10, 20, 30,
		]);
		expect(index.stats('session-1').canonicalRebuilds).toBe(1);
	});

	it('lazily synchronizes a restored transcript before the first live batch', () => {
		const index = new CanonicalEnvelopeIndex();
		const restored = [envelope(10), envelope(20)];

		const result = index.accept('session-1', restored, [envelope(20), envelope(30)]);

		expect(result).toEqual({
			accepted: [envelope(30)],
			monotonic: true,
		});
		expect(index.stats('session-1')).toEqual({
			monotonicAccepts: 1,
			canonicalRebuilds: 0,
		});
	});
});
