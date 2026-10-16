import { describe, expect, it } from 'vitest';
import { onboardingAccountsSettled, openOnboardingAccount } from './onboarding';

describe('onboarding accounts', () => {
	it('opens the first account that still needs the user', () => {
		expect(openOnboardingAccount({ 'claude-code': 'missing', github: 'signed-out' }, null)).toBe(
			'claude-code',
		);
		expect(openOnboardingAccount({ 'claude-code': 'ready', github: 'signed-out' }, null)).toBe(
			'github',
		);
	});

	it('opens the account the user picked until it is ready', () => {
		expect(
			openOnboardingAccount({ 'claude-code': 'missing', github: 'signed-out' }, 'github'),
		).toBe('github');
		expect(openOnboardingAccount({ 'claude-code': 'missing', github: 'ready' }, 'github')).toBe(
			'claude-code',
		);
	});

	it('opens nothing while an earlier account is still being checked', () => {
		expect(openOnboardingAccount({ 'claude-code': 'checking', github: 'signed-out' }, null)).toBe(
			null,
		);
		expect(openOnboardingAccount({ 'claude-code': 'ready', github: 'checking' }, null)).toBe(null);
	});

	it('opens nothing and settles once every account is ready', () => {
		const statuses = { 'claude-code': 'ready', github: 'ready' } as const;
		expect(openOnboardingAccount(statuses, null)).toBe(null);
		expect(onboardingAccountsSettled(statuses)).toBe(true);
		expect(onboardingAccountsSettled({ 'claude-code': 'ready', github: 'signed-out' })).toBe(false);
		expect(onboardingAccountsSettled({ 'claude-code': 'checking', github: 'ready' })).toBe(false);
	});

	it('settles when an account cannot be checked, so a failed check never traps the user', () => {
		expect(onboardingAccountsSettled({ 'claude-code': 'ready', github: 'unknown' })).toBe(true);
	});
});
