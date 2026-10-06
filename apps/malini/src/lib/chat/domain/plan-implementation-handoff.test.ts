import { describe, expect, it } from 'vitest';
import { buildImplementationHandoffPrompt } from './plan-implementation-handoff';

describe('buildImplementationHandoffPrompt', () => {
	it('carries the complete source request and approved plan into a fresh implementation turn', () => {
		const prompt = buildImplementationHandoffPrompt({
			originalRequest: 'Refactor the queue.\nKeep all context files.',
			plan: '1. Snapshot each model.\n2. Drain FIFO.\n3. Verify navigation.',
		});

		expect(prompt).toContain('fresh implementation chat');
		expect(prompt).toContain('Refactor the queue.\nKeep all context files.');
		expect(prompt).toContain('1. Snapshot each model.\n2. Drain FIFO.\n3. Verify navigation.');
		expect(prompt.indexOf('ORIGINAL REQUEST')).toBeLessThan(prompt.indexOf('APPROVED PLAN'));
	});

	it('rejects an empty plan instead of manufacturing a meaningless handoff', () => {
		expect(() => buildImplementationHandoffPrompt({ plan: '   ' })).toThrow(
			'Approved plan cannot be empty',
		);
	});
});
