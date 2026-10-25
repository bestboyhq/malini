export type SidebarGrouping = 'owner' | 'repository';

export type SidebarOrdering = 'manual' | 'newest' | 'name';

export type SidebarArrangement = Readonly<{
	grouping: SidebarGrouping;
	ordering: SidebarOrdering;
}>;

type Choice<T extends string> = Readonly<{ value: T; label: string }>;

export const SIDEBAR_GROUPINGS: readonly Choice<SidebarGrouping>[] = [
	{ value: 'owner', label: 'Organization' },
	{ value: 'repository', label: 'Repository' },
];

export const SIDEBAR_ORDERINGS: readonly Choice<SidebarOrdering>[] = [
	{ value: 'manual', label: 'Manual' },
	{ value: 'newest', label: 'Newest' },
	{ value: 'name', label: 'Name' },
];

export const DEFAULT_SIDEBAR_ARRANGEMENT: SidebarArrangement = {
	grouping: 'owner',
	ordering: 'manual',
};

export function readSidebarArrangement(raw: unknown): SidebarArrangement {
	if (typeof raw !== 'object' || raw === null) return DEFAULT_SIDEBAR_ARRANGEMENT;
	return {
		grouping: choiceOf(SIDEBAR_GROUPINGS, Reflect.get(raw, 'grouping'), 'owner'),
		ordering: choiceOf(SIDEBAR_ORDERINGS, Reflect.get(raw, 'ordering'), 'manual'),
	};
}

function choiceOf<T extends string>(choices: readonly Choice<T>[], raw: unknown, fallback: T): T {
	return choices.find((choice) => choice.value === raw)?.value ?? fallback;
}
