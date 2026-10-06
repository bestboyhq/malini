import { describe, expect, it } from 'vitest';
import type { ProviderCapability } from '$contract/agent';
import { claudeCodeStatus, setupStepFor, usesSubscription } from './claude-code-status';

const capability = (patch: Partial<ProviderCapability>): ProviderCapability => ({
	state: 'ready',
	installed: true,
	authenticated: true,
	version: '2.1.196',
	account: { email: 'dev@example.com', plan: 'Claude Max' },
	models: [],
	defaultModel: 'default',
	message: '',
	...patch,
});

describe('Claude Code status', () => {
	it('walks a new user from install to sign-in to ready', () => {
		const missing = claudeCodeStatus(capability({ state: 'missing', installed: false }), null);
		const signedOut = claudeCodeStatus(capability({ state: 'needs_auth', account: null }), null);
		const ready = claudeCodeStatus(capability({}), null);

		expect(setupStepFor(missing)).toBe('install');
		expect(setupStepFor(signedOut)).toBe('sign-in');
		expect(setupStepFor(ready)).toBeNull();
		expect(ready).toMatchObject({ kind: 'ready', account: { plan: 'Claude Max' } });
	});

	it('is checking until the first probe answers and unknown when it fails', () => {
		expect(claudeCodeStatus(null, null)).toEqual({ kind: 'checking' });
		expect(claudeCodeStatus(null, 'bridge down')).toEqual({
			kind: 'unknown',
			message: 'bridge down',
		});
	});

	it('hides per-run cost only for a Claude subscription', () => {
		expect(usesSubscription(claudeCodeStatus(capability({}), null))).toBe(true);
		expect(usesSubscription(claudeCodeStatus(capability({ account: {} }), null))).toBe(false);
		expect(usesSubscription({ kind: 'checking' })).toBe(false);
	});
});
