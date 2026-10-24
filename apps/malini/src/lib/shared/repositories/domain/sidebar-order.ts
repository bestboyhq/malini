export type SidebarOrder = Readonly<{
	repositoryIds: readonly string[];
	workstreamIds: readonly string[];
}>;

export type SidebarPlacement = 'before' | 'after';

export type SidebarMove = Readonly<{
	kind: 'repository' | 'workstream';
	listedIds: readonly string[];
	movedIds: readonly string[];
	targetIds: readonly string[];
	placement: SidebarPlacement;
}>;

export const DEFAULT_SIDEBAR_ORDER: SidebarOrder = { repositoryIds: [], workstreamIds: [] };

export function inSidebarOrder<T extends { readonly id: string }>(
	items: readonly T[],
	orderedIds: readonly string[],
): T[] {
	const rank = new Map(orderedIds.map((id, index) => [id, index]));
	return [...items].sort((left, right) => (rank.get(left.id) ?? -1) - (rank.get(right.id) ?? -1));
}

export function movedInSidebarOrder(
	listedIds: readonly string[],
	movedIds: readonly string[],
	targetIds: readonly string[],
	placement: SidebarPlacement,
): string[] {
	const moved = listedIds.filter((id) => movedIds.includes(id));
	const rest = listedIds.filter((id) => !movedIds.includes(id));
	const anchor = placement === 'before' ? targetIds[0] : targetIds.at(-1);
	const anchorIndex = anchor === undefined ? -1 : rest.indexOf(anchor);
	if (moved.length !== movedIds.length || anchorIndex === -1) return [...listedIds];
	rest.splice(placement === 'before' ? anchorIndex : anchorIndex + 1, 0, ...moved);
	return rest;
}

export function readSidebarOrder(raw: unknown): SidebarOrder {
	if (typeof raw !== 'object' || raw === null) return DEFAULT_SIDEBAR_ORDER;
	return {
		repositoryIds: readIds('repositoryIds' in raw ? raw.repositoryIds : null),
		workstreamIds: readIds('workstreamIds' in raw ? raw.workstreamIds : null),
	};
}

export function readIds(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	return raw.filter((id): id is string => typeof id === 'string');
}
