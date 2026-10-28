import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { agentRunWasAlreadyGone, JOB_CONTEXT_MAX_BYTES, truncateJobContext } from './job-run';

describe('truncateJobContext', () => {
	it('keeps a context that fits as it is', () => {
		expect(truncateJobContext('Fixed the lint.')).toBe('Fixed the lint.');
	});

	it('cuts a long context to the byte limit without splitting a character', () => {
		const text = `${'a'.repeat(JOB_CONTEXT_MAX_BYTES - 1)}é😀`;
		const truncated = truncateJobContext(text);

		expect(truncated).toBe('a'.repeat(JOB_CONTEXT_MAX_BYTES - 1));
		expect(Buffer.byteLength(truncateJobContext('😀'.repeat(JOB_CONTEXT_MAX_BYTES)))).toBe(
			JOB_CONTEXT_MAX_BYTES,
		);
	});
});

describe('agentRunWasAlreadyGone', () => {
	it('tells a cancel that found no run apart from a cancel that failed', () => {
		expect(agentRunWasAlreadyGone(new Error('cancel race: no active run for session'))).toBe(true);
		expect(agentRunWasAlreadyGone(new Error('bridge unavailable: socket closed'))).toBe(false);
	});
});
