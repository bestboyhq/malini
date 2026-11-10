export type SidebarGrouping = 'owner' | 'repository' | 'status' | 'day';

export type SidebarSubgrouping = 'none' | 'owner' | 'repository';

export type SidebarOrdering = 'manual' | 'active' | 'newest' | 'name';

export type SidebarShow = 'everything' | 'attention';

export type SidebarArrangement = Readonly<{
	grouping: SidebarGrouping;
	subgrouping: SidebarSubgrouping;
	ordering: SidebarOrdering;
	show: SidebarShow;
}>;

type Choice<T extends string> = Readonly<{ value: T; label: string }>;

export const SIDEBAR_GROUPINGS: readonly Choice<SidebarGrouping>[] = [
	{ value: 'owner', label: 'Organization' },
	{ value: 'repository', label: 'Repository' },
	{ value: 'status', label: 'Status' },
	{ value: 'day', label: 'Day' },
];

export const SIDEBAR_SUBGROUPINGS: readonly Choice<SidebarSubgrouping>[] = [
	{ value: 'none', label: 'No grouping' },
	{ value: 'owner', label: 'Organization' },
	{ value: 'repository', label: 'Repository' },
];

export const SIDEBAR_ORDERINGS: readonly Choice<SidebarOrdering>[] = [
	{ value: 'manual', label: 'Manual' },
	{ value: 'active', label: 'Last active' },
	{ value: 'newest', label: 'Created' },
	{ value: 'name', label: 'Name' },
];

export const SIDEBAR_SHOWS: readonly Choice<SidebarShow>[] = [
	{ value: 'everything', label: 'Everything' },
	{ value: 'attention', label: 'Attention' },
];

export const DEFAULT_SIDEBAR_ARRANGEMENT: SidebarArrangement = {
	grouping: 'owner',
	subgrouping: 'repository',
	ordering: 'manual',
	show: 'everything',
};

export function sectionedGrouping(grouping: SidebarGrouping): grouping is 'status' | 'day' {
	return grouping === 'status' || grouping === 'day';
}

export function isDefaultArrangement(arrangement: SidebarArrangement): boolean {
	return (
		arrangement.grouping === DEFAULT_SIDEBAR_ARRANGEMENT.grouping &&
		arrangement.subgrouping === DEFAULT_SIDEBAR_ARRANGEMENT.subgrouping &&
		arrangement.ordering === DEFAULT_SIDEBAR_ARRANGEMENT.ordering &&
		arrangement.show === DEFAULT_SIDEBAR_ARRANGEMENT.show
	);
}

export function showsAttentionOnly(arrangement: SidebarArrangement): boolean {
	return arrangement.show === 'attention' && arrangement.grouping === 'status';
}

export function arranged(
	current: SidebarArrangement,
	change: Partial<SidebarArrangement>,
): SidebarArrangement {
	const next = { ...current, ...change };
	if (change.show === 'attention') return { ...next, grouping: 'status' };
	return next.grouping === 'status' ? next : { ...next, show: 'everything' };
}

export function readSidebarArrangement(raw: unknown): SidebarArrangement {
	if (typeof raw !== 'object' || raw === null) return DEFAULT_SIDEBAR_ARRANGEMENT;
	return {
		grouping: choiceOf(SIDEBAR_GROUPINGS, Reflect.get(raw, 'grouping'), 'owner'),
		subgrouping: choiceOf(SIDEBAR_SUBGROUPINGS, Reflect.get(raw, 'subgrouping'), 'repository'),
		ordering: choiceOf(SIDEBAR_ORDERINGS, Reflect.get(raw, 'ordering'), 'manual'),
		show: choiceOf(SIDEBAR_SHOWS, Reflect.get(raw, 'show'), 'everything'),
	};
}

function choiceOf<T extends string>(choices: readonly Choice<T>[], raw: unknown, fallback: T): T {
	return choices.find((choice) => choice.value === raw)?.value ?? fallback;
}
