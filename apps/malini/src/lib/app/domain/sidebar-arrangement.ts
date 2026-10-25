export type SidebarGrouping = 'owner' | 'repository' | 'status' | 'day';

export type SidebarSubgrouping = 'none' | 'owner' | 'repository';

export type SidebarOrdering = 'manual' | 'active' | 'newest' | 'name';

export type SidebarArrangement = Readonly<{
	grouping: SidebarGrouping;
	subgrouping: SidebarSubgrouping;
	ordering: SidebarOrdering;
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

export const DEFAULT_SIDEBAR_ARRANGEMENT: SidebarArrangement = {
	grouping: 'owner',
	subgrouping: 'repository',
	ordering: 'manual',
};

export function sectionedGrouping(grouping: SidebarGrouping): grouping is 'status' | 'day' {
	return grouping === 'status' || grouping === 'day';
}

export function isDefaultArrangement(arrangement: SidebarArrangement): boolean {
	return (
		arrangement.grouping === DEFAULT_SIDEBAR_ARRANGEMENT.grouping &&
		arrangement.subgrouping === DEFAULT_SIDEBAR_ARRANGEMENT.subgrouping &&
		arrangement.ordering === DEFAULT_SIDEBAR_ARRANGEMENT.ordering
	);
}

export function readSidebarArrangement(raw: unknown): SidebarArrangement {
	if (typeof raw !== 'object' || raw === null) return DEFAULT_SIDEBAR_ARRANGEMENT;
	return {
		grouping: choiceOf(SIDEBAR_GROUPINGS, Reflect.get(raw, 'grouping'), 'owner'),
		subgrouping: choiceOf(SIDEBAR_SUBGROUPINGS, Reflect.get(raw, 'subgrouping'), 'repository'),
		ordering: choiceOf(SIDEBAR_ORDERINGS, Reflect.get(raw, 'ordering'), 'manual'),
	};
}

function choiceOf<T extends string>(choices: readonly Choice<T>[], raw: unknown, fallback: T): T {
	return choices.find((choice) => choice.value === raw)?.value ?? fallback;
}
