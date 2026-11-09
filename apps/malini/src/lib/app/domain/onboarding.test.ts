import { describe, expect, it } from 'vitest';
import {
	DEFAULT_ONBOARDING_SIDEBAR,
	claudeCodeOnboardingStatus,
	onboardingAccountsSettled,
	onboardingSidebarArrangement,
	openOnboardingAccount,
} from './onboarding';
import { DEFAULT_SIDEBAR_ARRANGEMENT } from './sidebar-arrangement';

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

	it('takes an installed Claude Code as done, signed in or not, but never a missing one', () => {
		expect(claudeCodeOnboardingStatus('signed-out')).toBe('ready');
		expect(claudeCodeOnboardingStatus('ready')).toBe('ready');
		expect(claudeCodeOnboardingStatus('missing')).toBe('missing');
		expect(claudeCodeOnboardingStatus('checking')).toBe('checking');
	});
});

describe('onboarding sidebar', () => {
	it('keeps the default sidebar for many repositories showing everything', () => {
		expect(onboardingSidebarArrangement(DEFAULT_ONBOARDING_SIDEBAR)).toEqual(
			DEFAULT_SIDEBAR_ARRANGEMENT,
		);
	});

	it('lists one project flat, grouped by status', () => {
		expect(
			onboardingSidebarArrangement({ ...DEFAULT_ONBOARDING_SIDEBAR, where: 'one' }),
		).toMatchObject({ grouping: 'status', subgrouping: 'none', show: 'everything' });
	});

	it('nests repositories under the statuses that need you across many repositories', () => {
		expect(
			onboardingSidebarArrangement({ ...DEFAULT_ONBOARDING_SIDEBAR, show: 'attention' }),
		).toMatchObject({ grouping: 'status', subgrouping: 'repository', show: 'attention' });
	});

	it('lists one project flat when only what needs you shows', () => {
		expect(
			onboardingSidebarArrangement({
				...DEFAULT_ONBOARDING_SIDEBAR,
				where: 'one',
				show: 'attention',
			}),
		).toMatchObject({ grouping: 'status', subgrouping: 'none', show: 'attention' });
	});
});
