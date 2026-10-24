import type { ConnectedRepositoryContext } from '$shared/repositories/domain/repository-context';

export type SidebarOwnerFolder = Readonly<{
	kind: 'owner';
	id: string;
	owner: string;
	rows: readonly ConnectedRepositoryContext[];
}>;

export type SidebarRepositoryEntry = Readonly<{
	kind: 'repository';
	id: string;
	row: ConnectedRepositoryContext;
}>;

export type SidebarEntry = SidebarOwnerFolder | SidebarRepositoryEntry;

export function sidebarEntries(rows: readonly ConnectedRepositoryContext[]): SidebarEntry[] {
	const byOwner = new Map<string, ConnectedRepositoryContext[]>();
	for (const row of rows) {
		const key = ownerKey(row);
		if (key === null) continue;
		const owned = byOwner.get(key);
		if (owned) owned.push(row);
		else byOwner.set(key, [row]);
	}
	const entries: SidebarEntry[] = [];
	const folded = new Set<string>();
	for (const row of rows) {
		const key = ownerKey(row);
		const owned = key === null ? [] : (byOwner.get(key) ?? []);
		if (key === null || owned.length < 2) {
			entries.push({ kind: 'repository', id: row.repo.id, row });
			continue;
		}
		if (folded.has(key)) continue;
		folded.add(key);
		entries.push({ kind: 'owner', id: ownerFolderId(key), owner: row.owner ?? key, rows: owned });
	}
	return entries;
}

export function entryRepositoryIds(entry: SidebarEntry): string[] {
	return entry.kind === 'owner' ? entry.rows.map((row) => row.repo.id) : [entry.row.repo.id];
}

export function showsAsOneLine(row: ConnectedRepositoryContext): boolean {
	return row.workstreams.length === 1;
}

export function ownerFolderId(owner: string): string {
	return `owner:${owner.toLowerCase()}`;
}

function ownerKey(row: ConnectedRepositoryContext): string | null {
	return row.owner?.toLowerCase() ?? null;
}
