import { describe, expect, it } from 'vitest';
import {
	customArrangement,
	presetArrangement,
	presetArranged,
	sidebarPreset,
	type SidebarPreset,
} from './sidebar-preset';
import { DEFAULT_SIDEBAR_ARRANGEMENT, type SidebarArrangement } from './sidebar-arrangement';

const SEPARATE_EVERYTHING: SidebarPreset = { repositories: 'separate', show: 'everything' };

describe('sidebar preset', () => {
	it('keeps the default sidebar for separate repositories showing everything', () => {
		expect(presetArrangement(SEPARATE_EVERYTHING)).toEqual(
			DEFAULT_SIDEBAR_ARRANGEMENT,
		);
	});

	it('lists mixed repositories flat, grouped by status', () => {
		expect(
			presetArrangement({ ...SEPARATE_EVERYTHING, repositories: 'mixed' }),
		).toMatchObject({ grouping: 'status', subgrouping: 'none', show: 'everything' });
	});

	it('nests repositories under the statuses that need you when repositories stay separate', () => {
		expect(
			presetArrangement({ ...SEPARATE_EVERYTHING, show: 'attention' }),
		).toMatchObject({ grouping: 'status', subgrouping: 'repository', show: 'attention' });
	});

	it('lists mixed repositories flat when only what needs you shows', () => {
		expect(
			presetArrangement({
				...SEPARATE_EVERYTHING,
				repositories: 'mixed',
				show: 'attention',
			}),
		).toMatchObject({ grouping: 'status', subgrouping: 'none', show: 'attention' });
	});
});

describe('sidebar options', () => {
	const flat = presetArrangement({ repositories: 'mixed', show: 'everything' });

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
		const attention = presetArrangement({ repositories: 'separate', show: 'attention' });
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
