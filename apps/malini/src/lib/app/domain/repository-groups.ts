import type { Repository } from '$shared/repositories/domain/repository';
import { repositoryOwner } from '$shared/repositories/domain/repository-context';

export type OwnerGroup<T> = Readonly<{
	kind: 'owner';
	id: string;
	owner: string;
	items: readonly T[];
}>;

export type LoneRepository<T> = Readonly<{
	kind: 'repository';
	id: string;
	item: T;
}>;

export type RepositoryGroup<T> = OwnerGroup<T> | LoneRepository<T>;

export function repositoryGroups<T>(
	items: readonly T[],
	repositoryOf: (item: T) => Repository,
): RepositoryGroup<T>[] {
	const byOwner = new Map<string, T[]>();
	for (const item of items) {
		const key = ownerKey(repositoryOf(item));
		if (key === null) continue;
		const owned = byOwner.get(key);
		if (owned) owned.push(item);
		else byOwner.set(key, [item]);
	}
	const groups: RepositoryGroup<T>[] = [];
	const folded = new Set<string>();
	for (const item of items) {
		const repository = repositoryOf(item);
		const key = ownerKey(repository);
		const owned = key === null ? [] : (byOwner.get(key) ?? []);
		if (key === null || owned.length < 2) {
			groups.push({ kind: 'repository', id: repository.id, item });
			continue;
		}
		if (folded.has(key)) continue;
		folded.add(key);
		groups.push({
			kind: 'owner',
			id: ownerGroupId(key),
			owner: repositoryOwner(repository.fullName) ?? key,
			items: owned,
		});
	}
	return groups;
}

export function groupItems<T>(group: RepositoryGroup<T>): readonly T[] {
	return group.kind === 'owner' ? group.items : [group.item];
}

export function ownerGroupId(owner: string): string {
	return `owner:${owner.toLowerCase()}`;
}

function ownerKey(repository: Repository): string | null {
	return repositoryOwner(repository.fullName)?.toLowerCase() ?? null;
}
