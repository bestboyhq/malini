import type { ExtensionDirectoryEntry } from './extension-directory-entry';

export function searchExtensionDirectory(
	entries: readonly ExtensionDirectoryEntry[],
	query: string,
): readonly ExtensionDirectoryEntry[] {
	const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
	if (terms.length === 0) return [...entries].sort(compareDirectoryEntries);
	return entries
		.filter((entry) => {
			const haystack = [
				entry.name,
				entry.id,
				entry.summary,
				entry.publisher,
				entry.author.name,
				...entry.tags,
			]
				.join(' ')
				.toLocaleLowerCase();
			return terms.every((term) => haystack.includes(term));
		})
		.sort(compareDirectoryEntries);
}

function compareDirectoryEntries(
	left: ExtensionDirectoryEntry,
	right: ExtensionDirectoryEntry,
): number {
	if (left.firstParty !== right.firstParty) return left.firstParty ? -1 : 1;
	return left.name.localeCompare(right.name);
}
