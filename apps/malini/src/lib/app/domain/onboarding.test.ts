import { describe, expect, it } from 'vitest';
import {
	DEFAULT_ONBOARDING_SIDEBAR,
	claudeCodeOnboardingStatus,
	customArrangement,
	onboardingSidebarArrangement,
	onboardingToolsSettled,
	presetArranged,
	sidebarPreset,
} from './onboarding';
import { DEFAULT_SIDEBAR_ARRANGEMENT, type SidebarArrangement } from './sidebar-arrangement';

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
	it('keeps the default sidebar for separate repositories showing everything', () => {
		expect(onboardingSidebarArrangement(DEFAULT_ONBOARDING_SIDEBAR)).toEqual(
			DEFAULT_SIDEBAR_ARRANGEMENT,
		);
	});

	it('lists mixed repositories flat, grouped by status', () => {
		expect(
			onboardingSidebarArrangement({ ...DEFAULT_ONBOARDING_SIDEBAR, repositories: 'mixed' }),
		).toMatchObject({ grouping: 'status', subgrouping: 'none', show: 'everything' });
	});

	it('nests repositories under the statuses that need you when repositories stay separate', () => {
		expect(
			onboardingSidebarArrangement({ ...DEFAULT_ONBOARDING_SIDEBAR, show: 'attention' }),
		).toMatchObject({ grouping: 'status', subgrouping: 'repository', show: 'attention' });
	});

	it('lists mixed repositories flat when only what needs you shows', () => {
		expect(
			onboardingSidebarArrangement({
				...DEFAULT_ONBOARDING_SIDEBAR,
				repositories: 'mixed',
				show: 'attention',
			}),
		).toMatchObject({ grouping: 'status', subgrouping: 'none', show: 'attention' });
	});
});

describe('sidebar options', () => {
	const flat = onboardingSidebarArrangement({ repositories: 'mixed', show: 'everything' });

	it('reads repositories as mixed only when a status or day list is flat', () => {
		expect(sidebarPreset(DEFAULT_SIDEBAR_ARRANGEMENT).repositories).toBe('separate');
		expect(sidebarPreset({ ...flat, grouping: 'repository' }).repositories).toBe('separate');
		expect(sidebarPreset({ ...flat, subgrouping: 'owner' }).repositories).toBe('separate');
		expect(sidebarPreset(flat).repositories).toBe('mixed');
		expect(sidebarPreset({ ...flat, grouping: 'day' }).repositories).toBe('mixed');
	});

	it('applies the preset of a new repositories or show answer and keeps the ordering', () => {
		const byName: SidebarArrangement = { ...DEFAULT_SIDEBAR_ARRANGEMENT, ordering: 'name' };
		expect(presetArranged(byName, { repositories: 'mixed' })).toEqual({
			...flat,
			ordering: 'name',
		});
		expect(presetArranged({ ...flat, ordering: 'name' }, { show: 'attention' })).toEqual({
			...flat,
			show: 'attention',
			ordering: 'name',
		});
	});

	it('lands Show all on the preset of the repositories answer', () => {
		const attention = onboardingSidebarArrangement({ repositories: 'separate', show: 'attention' });
		const shown = presetArranged(attention, { show: 'everything' });
		expect(shown).toEqual(DEFAULT_SIDEBAR_ARRANGEMENT);
		expect(customArrangement(shown)).toBe(false);
	});

	it('is custom once the grouping or ordering leaves the preset', () => {
		expect(customArrangement(DEFAULT_SIDEBAR_ARRANGEMENT)).toBe(false);
		expect(customArrangement(flat)).toBe(false);
		expect(customArrangement({ ...flat, grouping: 'day' })).toBe(true);
		expect(customArrangement({ ...DEFAULT_SIDEBAR_ARRANGEMENT, grouping: 'repository' })).toBe(
			true,
		);
		expect(customArrangement({ ...DEFAULT_SIDEBAR_ARRANGEMENT, ordering: 'active' })).toBe(true);
	});
});
