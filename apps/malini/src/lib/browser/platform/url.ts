import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER_WORKTREE_SCHEME } from '$contract/browser';
import { isAtOrInsideDirectory } from '$main/fs/paths';

export const BLANK_PAGE = 'about:blank';

const SCHEME = /^[a-z][a-z\d+.-]*:(?!\d)/i;
const PORT = /:\d+$/;
const LOCAL_HOST = /^(?:localhost|.+\.localhost|\[[\da-f:.]+\]|\d{1,3}(?:\.\d{1,3}){3})$/i;
const FILE_ADDRESS = /^(?:file:|\.{0,2}\/)/i;
const PATH_QUERY_HASH = /^([^?#]*)(\?[^#]*)?(#.*)?$/su;
const WORKTREE_PROTOCOL = `${BROWSER_WORKTREE_SCHEME}:`;
const PAGE_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', WORKTREE_PROTOCOL]);

export function isAllowedUrl(url: string): boolean {
	if (url === BLANK_PAGE) return true;
	try {
		return PAGE_PROTOCOLS.has(new URL(url).protocol);
	} catch {
		return false;
	}
}

export function isAllowedNavigation(from: string, to: string): boolean {
	const target = worktreeHost(to);
	return isAllowedUrl(to) && (target === null || target === worktreeHost(from));
}

export function isLocalUrl(url: string): boolean {
	return LOCAL_HOST.test(new URL(url).hostname);
}

export function isFileAddress(input: string): boolean {
	return FILE_ADDRESS.test(input.trim());
}

export function normalizeBrowserUrl(input: string): string {
	const text = input.trim();
	if (text.length === 0) throw new Error('Type a URL to open.');
	const candidate = SCHEME.test(text) ? text : `${schemeFor(text)}//${text}`;
	let url: URL;
	try {
		url = new URL(candidate);
	} catch {
		throw new Error(`\`${text}\` is not a URL.`);
	}
	if (!isAllowedUrl(url.href)) {
		throw new Error('Only web pages and files in the worktree open in the browser.');
	}
	return url.href;
}

export function worktreeFileUrl(input: string, workstreamId: string, worktree: string): string {
	const text = input.trim();
	const fileUrl = /^file:/i.test(text) ? new URL(text) : null;
	const [, filePath = '', search = '', hash = ''] = PATH_QUERY_HASH.exec(text) ?? [];
	const path = fileUrl ? fileURLToPath(fileUrl) : resolve(worktree, filePath);
	if (!isAtOrInsideDirectory(worktree, path)) {
		throw new Error(
			`\`${text}\` is outside the worktree; only files inside it open in the browser.`,
		);
	}
	const url = new URL(`${WORKTREE_PROTOCOL}//${workstreamId.toLowerCase()}/`);
	url.pathname = `/${relative(worktree, path).split(sep).map(encodeURIComponent).join('/')}`;
	url.search = fileUrl?.search ?? search;
	url.hash = fileUrl?.hash ?? hash;
	return url.href;
}

function worktreeHost(url: string): string | null {
	try {
		const parsed = new URL(url);
		return parsed.protocol === WORKTREE_PROTOCOL ? parsed.host.toLowerCase() : null;
	} catch {
		return null;
	}
}

function schemeFor(text: string): 'http:' | 'https:' {
	const host = text.split(/[/?#]/, 1)[0] ?? '';
	return PORT.test(host) || LOCAL_HOST.test(host) ? 'http:' : 'https:';
}
