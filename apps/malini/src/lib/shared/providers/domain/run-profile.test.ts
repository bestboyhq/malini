import { describe, expect, it } from 'vitest';
import { normalizeAgentRunProfile } from './run-profile';

describe('normalizeAgentRunProfile', () => {
	it('gives a profile stored before access existed the default access', () => {
		expect(normalizeAgentRunProfile({ effort: 'high', mode: 'agent' }, 'auto')).toEqual({
			effort: 'high',
			mode: 'agent',
			access: 'auto',
		});
	});

	it('keeps a chosen access and rejects an unknown one', () => {
		expect(
			normalizeAgentRunProfile({ effort: 'low', mode: 'plan', access: 'full' }, 'auto')?.access,
		).toBe('full');
		expect(normalizeAgentRunProfile({ effort: 'low', mode: 'plan', access: 'root' }, 'auto')).toBe(
			null,
		);
	});
});
