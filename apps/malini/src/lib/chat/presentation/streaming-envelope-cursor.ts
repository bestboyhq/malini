import type { EventEnvelope } from '$lib/chat/domain/events';

export type StreamingEnvelopeCursor = {
	readonly processedKeys: Set<string>;
	highestSeq: number;
	lastObservedLength: number;
};

function keyFor(envelope: EventEnvelope): string {
	return `${envelope.sessionId}:${envelope.runId}:${envelope.seq}`;
}

export function createStreamingEnvelopeCursor(): StreamingEnvelopeCursor {
	return {
		processedKeys: new Set<string>(),
		highestSeq: Number.NEGATIVE_INFINITY,
		lastObservedLength: 0,
	};
}

function firstIndexAbove(envelopes: readonly EventEnvelope[], seq: number): number {
	let low = 0;
	let high = envelopes.length;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		const candidate = envelopes[middle];
		if (candidate === undefined || candidate.seq <= seq) low = middle + 1;
		else high = middle;
	}
	return low;
}

export function takeUnprocessedEnvelopes(
	envelopes: readonly EventEnvelope[],
	cursor: StreamingEnvelopeCursor,
): EventEnvelope[] {
	const result: EventEnvelope[] = [];
	const suffixStart = firstIndexAbove(envelopes, cursor.highestSeq);

	for (let index = suffixStart; index < envelopes.length; index += 1) {
		const envelope = envelopes[index];
		if (envelope && !cursor.processedKeys.has(keyFor(envelope))) result.push(envelope);
	}

	const possibleUnseenCount = Math.max(0, envelopes.length - cursor.processedKeys.size);
	if (possibleUnseenCount > result.length || envelopes.length < cursor.lastObservedLength) {
		for (let index = 0; index < suffixStart; index += 1) {
			const envelope = envelopes[index];
			if (envelope && !cursor.processedKeys.has(keyFor(envelope))) result.push(envelope);
		}
	}

	result.sort((left, right) => left.seq - right.seq);
	for (const envelope of result) {
		cursor.processedKeys.add(keyFor(envelope));
		cursor.highestSeq = Math.max(cursor.highestSeq, envelope.seq);
	}
	cursor.lastObservedLength = envelopes.length;
	return result;
}
