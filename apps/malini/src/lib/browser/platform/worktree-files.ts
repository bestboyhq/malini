import { realpath, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { net, protocol, session, type CustomScheme } from 'electron';
import { BROWSER_WORKTREE_SCHEME, stillPageUrl } from '$contract/browser';
import { isInsideDirectory } from '$main/fs/paths';
import { AGENT_ATTACHMENTS_PATH } from '$main/git/paths';
import { BROWSER_PARTITION } from './electron-view';
import type { PageStills } from './page-stills';

const APP_MANAGED_DIR = dirname(AGENT_ATTACHMENTS_PATH);
const PAGE = /\.html?$/iu;
const PLAIN_TEXT = /\.(?:md|markdown|txt|csv|json)$/iu;
const DOCTYPE = /^(?:\xEF\xBB\xBF)?\s*<!doctype[^>]*>/iu;
// ponytail: only the nearest scroller moves, so a target inside a nested scroller leaves the page itself still; walk the page's scrollers if a preview needs both
const CONTAINED_SCROLL = Buffer.from(
	"<script>{const scroll=Element.prototype.scrollIntoView;Element.prototype.scrollIntoView=function(options){const contained={...(typeof options==='object'&&options!==null?options:{block:options===false?'end':'start'}),container:'nearest'};if(innerHeight>0)return scroll.call(this,contained);const sized=()=>{if(innerHeight===0)return;removeEventListener('resize',sized);scroll.call(this,contained)};addEventListener('resize',sized)}}</script>",
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

export function serveWorktreeFiles(
	worktreeOf: (host: string) => string | null,
	stills: Pick<PageStills, 'still'>,
): void {
	const serve =
		(framedInMalini: boolean) =>
		async (request: Request): Promise<Response> => {
			const url = new URL(request.url);
			const worktree = worktreeOf(url.hostname);
			const file = worktree ? await worktreeFile(worktree, decodeURIComponent(url.pathname)) : null;
			if (!file)
				return new Response(`${url.pathname} is not a file in this worktree.`, { status: 404 });
			const stillOf = framedInMalini ? stillPageUrl(request.url) : null;
			if (stillOf !== null)
				return stillResponse(await stills.still(stillOf, file).catch(() => null));
			const response = await net.fetch(pathToFileURL(file).href);
			return served(
				file,
				framedInMalini && PAGE.test(file) ? await containScroll(response) : response,
			);
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

function stillResponse(still: Buffer | null): Response {
	if (still === null) return new Response('This page painted nothing.', { status: 404 });
	return new Response(new Uint8Array(still), {
		headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' },
	});
}

export function served(file: string, response: Response): Response {
	const headers = new Headers(response.headers);
	headers.set('Cache-Control', 'no-store');
	if (PLAIN_TEXT.test(file)) headers.set('Content-Type', 'text/plain; charset=utf-8');
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
