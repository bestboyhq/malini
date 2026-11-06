import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
	agentRunWasAlreadyGone,
	AUTOMATION_CONTEXT_MAX_BYTES,
	truncateAutomationContext,
} from './automation-run';

describe('truncateAutomationContext', () => {
	it('keeps a context that fits as it is', () => {
		expect(truncateAutomationContext('Fixed the lint.')).toBe('Fixed the lint.');
	});

	it('cuts a long context to the byte limit without splitting a character', () => {
		const text = `${'a'.repeat(AUTOMATION_CONTEXT_MAX_BYTES - 1)}é😀`;
		const truncated = truncateAutomationContext(text);

		expect(truncated).toBe('a'.repeat(AUTOMATION_CONTEXT_MAX_BYTES - 1));
		expect(
			Buffer.byteLength(truncateAutomationContext('😀'.repeat(AUTOMATION_CONTEXT_MAX_BYTES))),
		).toBe(AUTOMATION_CONTEXT_MAX_BYTES);
	});
});

describe('agentRunWasAlreadyGone', () => {
	it('tells a cancel that found no run apart from a cancel that failed', () => {
		expect(agentRunWasAlreadyGone(new Error('cancel race: no active run for session'))).toBe(true);
		expect(agentRunWasAlreadyGone(new Error('bridge unavailable: socket closed'))).toBe(false);
	});
});
