import type { RepositoryFileTarget } from './repository-file-target';

export type FileMentionIndex = ReadonlyMap<string, readonly string[]>;

export function indexFileMentionPaths(paths: readonly string[]): FileMentionIndex {
	const index = new Map<string, string[]>();
	for (const path of paths) {
		const name = fileName(path);
		const named = index.get(name);
		if (named) named.push(path);
		else index.set(name, [path]);
	}
	return index;
}

export function resolveFileMention(
	index: FileMentionIndex,
	target: RepositoryFileTarget,
): readonly RepositoryFileTarget[] {
	const named = index.get(fileName(target.path)) ?? [];
	if (named.includes(target.path)) return [target];
	const suffix = `/${target.path}`;
	return named.filter((path) => path.endsWith(suffix)).map((path) => ({ path, line: target.line }));
}

function fileName(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}
