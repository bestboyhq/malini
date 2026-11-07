import { realpath, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { net, protocol, session, type CustomScheme } from 'electron';
import { BROWSER_WORKTREE_SCHEME } from '$contract/browser';
import { isInsideDirectory } from '$main/fs/paths';
import { AGENT_ATTACHMENTS_PATH } from '$main/git/paths';
import { BROWSER_PARTITION } from './electron-view';

const APP_MANAGED_DIR = dirname(AGENT_ATTACHMENTS_PATH);
const PAGE = /\.html?$/iu;
const DOCTYPE = /^(?:\xEF\xBB\xBF)?\s*<!doctype[^>]*>/iu;
// ponytail: only the nearest scroller moves, so a target inside a nested scroller leaves the page itself still; walk the page's scrollers if a preview needs both
const CONTAINED_SCROLL = Buffer.from(
	"<script>{const scroll=Element.prototype.scrollIntoView;Element.prototype.scrollIntoView=function(options){scroll.call(this,{...(typeof options==='object'&&options!==null?options:{block:options===false?'end':'start'}),container:'nearest'})}}</script>",
);

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
	const serve =
		(framedInMalini: boolean) =>
		async (request: Request): Promise<Response> => {
			const url = new URL(request.url);
			const worktree = worktreeOf(url.hostname);
			const file = worktree ? await worktreeFile(worktree, decodeURIComponent(url.pathname)) : null;
			if (!file)
				return new Response(`${url.pathname} is not a file in this worktree.`, { status: 404 });
			const response = await net.fetch(pathToFileURL(file).href);
			return uncached(framedInMalini && PAGE.test(file) ? await containScroll(response) : response);
		};
	session.fromPartition(BROWSER_PARTITION).protocol.handle(BROWSER_WORKTREE_SCHEME, serve(false));
	protocol.handle(BROWSER_WORKTREE_SCHEME, serve(true));
}

async function containScroll(response: Response): Promise<Response> {
	const page = Buffer.from(await response.arrayBuffer());
	const at = DOCTYPE.exec(page.toString('latin1', 0, 1024))?.[0].length ?? 0;
	const headers = new Headers(response.headers);
	headers.delete('Content-Length');
	return new Response(Buffer.concat([page.subarray(0, at), CONTAINED_SCROLL, page.subarray(at)]), {
		status: response.status,
		headers,
	});
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
