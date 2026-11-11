import { describe, expect, it } from 'vitest';
import {
	DEFAULT_ONBOARDING_SIDEBAR,
	claudeCodeOnboardingStatus,
	onboardingSidebarArrangement,
	onboardingToolsSettled,
} from './onboarding';
import { DEFAULT_SIDEBAR_ARRANGEMENT } from './sidebar-arrangement';

describe('onboarding tools', () => {
	it('settles once every tool is ready', () => {
		expect(onboardingToolsSettled({ 'claude-code': 'ready', github: 'ready' })).toBe(true);
		expect(onboardingToolsSettled({ 'claude-code': 'ready', github: 'signed-out' })).toBe(false);
		expect(onboardingToolsSettled({ 'claude-code': 'checking', github: 'ready' })).toBe(false);
	});

	it('settles when a tool cannot be checked, so a failed check never traps the user', () => {
		expect(onboardingToolsSettled({ 'claude-code': 'ready', github: 'unknown' })).toBe(true);
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
