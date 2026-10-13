import { describe, expect, it } from 'vitest';
import { isValidAgentRunProfile, normalizeAgentRunProfile } from './run-profile';

describe('normalizeAgentRunProfile', () => {
	it('gives a profile stored before access existed the default access', () => {
		expect(normalizeAgentRunProfile({ effort: 'high', mode: 'agent' }, 'auto')).toEqual({
			effort: 'high',
			mode: 'agent',
			access: 'auto',
			report: 'medium',
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

	it('gives a profile stored before reports existed the medium report', () => {
		expect(
			normalizeAgentRunProfile({ effort: 'low', mode: 'plan', access: 'full' }, 'auto')?.report,
		).toBe('medium');
	});

	it('keeps a chosen report and rejects an unknown one', () => {
		const stored = { effort: 'low', mode: 'agent', access: 'full' };
		expect(normalizeAgentRunProfile({ ...stored, report: 'high' }, 'auto')?.report).toBe('high');
		expect(normalizeAgentRunProfile({ ...stored, report: 'verbose' }, 'auto')).toBe(null);
	});
});

describe('isValidAgentRunProfile', () => {
	it('takes a profile only once it carries a report', () => {
		const profile = { effort: 'low', mode: 'agent', access: 'full' };
		expect(isValidAgentRunProfile(profile)).toBe(false);
		expect(isValidAgentRunProfile({ ...profile, report: 'low' })).toBe(true);
	});
});
