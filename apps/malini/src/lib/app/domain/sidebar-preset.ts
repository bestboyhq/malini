import {
	DEFAULT_SIDEBAR_ARRANGEMENT,
	sectionedGrouping,
	type SidebarArrangement,
	type SidebarShow,
} from './sidebar-arrangement';

export type SidebarRepositories = 'separate' | 'mixed';

export type SidebarPreset = Readonly<{ repositories: SidebarRepositories; show: SidebarShow }>;

export function presetArrangement({ repositories, show }: SidebarPreset): SidebarArrangement {
	if (repositories === 'separate' && show === 'everything') return DEFAULT_SIDEBAR_ARRANGEMENT;
	return {
		...DEFAULT_SIDEBAR_ARRANGEMENT,
		grouping: 'status',
		subgrouping: repositories === 'separate' ? 'repository' : 'none',
		show,
	};
}

export function sidebarPreset({ grouping, subgrouping, show }: SidebarArrangement): SidebarPreset {
	return {
		repositories: sectionedGrouping(grouping) && subgrouping === 'none' ? 'mixed' : 'separate',
		show,
	};
}

export function presetArranged(
	current: SidebarArrangement,
	change: Partial<SidebarPreset>,
): SidebarArrangement {
	return {
		...presetArrangement({ ...sidebarPreset(current), ...change }),
		ordering: current.ordering,
	};
}

export function customArrangement(arrangement: SidebarArrangement): boolean {
	const preset = presetArrangement(sidebarPreset(arrangement));
	return (
		arrangement.grouping !== preset.grouping ||
		arrangement.subgrouping !== preset.subgrouping ||
		arrangement.ordering !== 'manual'
	);
}
