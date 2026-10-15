import { realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { net, protocol, session } from 'electron';
import { BROWSER_WORKTREE_SCHEME } from '$contract/browser';
import { isInsideDirectory } from '$main/fs/paths';
import { BROWSER_PARTITION } from './electron-view';

export function declareWorktreeScheme(): void {
	protocol.registerSchemesAsPrivileged([
		{
			scheme: BROWSER_WORKTREE_SCHEME,
			privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
		},
	]);
}

export function serveWorktreeFiles(worktreeOf: (host: string) => string | null): void {
	session
		.fromPartition(BROWSER_PARTITION)
		.protocol.handle(BROWSER_WORKTREE_SCHEME, async (request) => {
			const url = new URL(request.url);
			const worktree = worktreeOf(url.hostname);
			const file = worktree ? await worktreeFile(worktree, decodeURIComponent(url.pathname)) : null;
			return file
				? net.fetch(pathToFileURL(file).href)
				: new Response(`${url.pathname} is not a file in this worktree.`, { status: 404 });
		});
}

export async function worktreeFile(worktree: string, pathname: string): Promise<string | null> {
	try {
		const root = await realpath(worktree);
		const target = await realpath(join(root, pathname));
		const file = (await stat(target)).isDirectory()
			? await realpath(join(target, 'index.html'))
			: target;
		return isInsideDirectory(root, file) && (await stat(file)).isFile() ? file : null;
	} catch {
		return null;
	}
}
