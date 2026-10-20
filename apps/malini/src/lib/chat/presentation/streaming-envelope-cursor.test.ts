import { describe, expect, it } from 'vitest';
import type { AgentEvent, EventEnvelope } from '$lib/chat/domain/events';
import {
	createStreamingEnvelopeCursor,
	takeUnprocessedEnvelopes,
} from './streaming-envelope-cursor';

function envelope(seq: number, event: AgentEvent): EventEnvelope {
	return { sessionId: 'session-1', runId: 'run-1', seq, event };
}

describe('takeUnprocessedEnvelopes', () => {
	it('processes a lower replay insertion after a higher live envelope exactly once', () => {
		const cursor = createStreamingEnvelopeCursor();
		const answer = envelope(30, {
			type: 'assistant.message',
			runId: 'run-1',
			contentId: 'answer',
			text: 'Live answer',
		});
		const thought = envelope(20, {
			type: 'thinking.message',
			runId: 'run-1',
			contentId: 'thought',
			text: 'Replayed thought',
		});

		expect(takeUnprocessedEnvelopes([answer], cursor).map((item) => item.seq)).toEqual([30]);
		expect(takeUnprocessedEnvelopes([thought, answer], cursor).map((item) => item.seq)).toEqual([
			20,
		]);
		expect(takeUnprocessedEnvelopes([thought, answer], cursor)).toEqual([]);
	});

	it('returns only the append suffix on the normal live path', () => {
		const cursor = createStreamingEnvelopeCursor();
		const first = envelope(1, { type: 'run.started', runId: 'run-1', sessionId: 'session-1' });
		const second = envelope(2, {
			type: 'assistant.message',
			runId: 'run-1',
			text: 'hello',
		});

		expect(takeUnprocessedEnvelopes([first], cursor)).toEqual([first]);
		expect(takeUnprocessedEnvelopes([first, second], cursor)).toEqual([second]);
	});
});
