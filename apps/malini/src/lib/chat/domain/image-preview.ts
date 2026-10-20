export type ImagePreview =
	Readonly<{ status: 'ready'; src: string }> | Readonly<{ status: 'unavailable'; reason: string }>;

export type WorkstreamImage = Readonly<{ owner: string; workstreamId: string; path: string }>;

export function imagePreviewKey(owner: string, subject: string): string {
	return `${owner}\u0000${subject}`;
}

export function imagePreviewOwner(key: string): string {
	return key.slice(0, key.indexOf('\u0000'));
}

export function workstreamPathChanged(
	changedPaths: readonly string[] | null,
): (path: string) => boolean {
	if (changedPaths === null) return () => true;
	const changed = new Set(changedPaths.map(worktreeRelativePath));
	return (path) => changed.has(worktreeRelativePath(path));
}

function worktreeRelativePath(path: string): string {
	return path
		.split('/')
		.filter((segment) => segment !== '' && segment !== '.')
		.join('/');
}
