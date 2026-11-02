import { realpath, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { net, protocol, session, type CustomScheme } from 'electron';
import { BROWSER_WORKTREE_SCHEME } from '$contract/browser';
import { isInsideDirectory } from '$main/fs/paths';
import { AGENT_ATTACHMENTS_PATH } from '$main/git/paths';
import { BROWSER_PARTITION } from './electron-view';

const APP_MANAGED_DIR = dirname(AGENT_ATTACHMENTS_PATH);

export function declareWorktreeScheme(otherSchemes: readonly CustomScheme[] = []): void {
	protocol.registerSchemesAsPrivileged([
		{
			scheme: BROWSER_WORKTREE_SCHEME,
			privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
		},
		...otherSchemes,
	]);
}

export function serveWorktreeFiles(worktreeOf: (host: string) => string | null): void {
	const serve = async (request: Request): Promise<Response> => {
		const url = new URL(request.url);
		const worktree = worktreeOf(url.hostname);
		const file = worktree ? await worktreeFile(worktree, decodeURIComponent(url.pathname)) : null;
		return file
			? uncached(await net.fetch(pathToFileURL(file).href))
			: new Response(`${url.pathname} is not a file in this worktree.`, { status: 404 });
	};
	session.fromPartition(BROWSER_PARTITION).protocol.handle(BROWSER_WORKTREE_SCHEME, serve);
	protocol.handle(BROWSER_WORKTREE_SCHEME, serve);
}

function uncached(response: Response): Response {
	const headers = new Headers(response.headers);
	headers.set('Cache-Control', 'no-store');
	return new Response(response.body, { status: response.status, headers });
}

export async function worktreeFile(worktree: string, pathname: string): Promise<string | null> {
	try {
		const root = await realpath(worktree);
		const target = await realpath(join(root, pathname));
		const file = (await stat(target)).isDirectory()
			? await realpath(join(target, 'index.html'))
			: target;
		const inside = relative(root, file);
		return isInsideDirectory(root, file) &&
			inside !== APP_MANAGED_DIR &&
			!inside.startsWith(`${APP_MANAGED_DIR}/`) &&
			(await stat(file)).isFile()
			? file
			: null;
	} catch {
		return null;
	}
}
