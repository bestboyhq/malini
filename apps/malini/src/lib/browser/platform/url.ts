export const BLANK_PAGE = 'about:blank';

const SCHEME = /^[a-z][a-z\d+.-]*:(?!\d)/i;
const PORT = /:\d+$/;
const LOCAL_HOST = /^(?:localhost|.+\.localhost|\[[\da-f:.]+\]|\d{1,3}(?:\.\d{1,3}){3})$/i;
const WEB_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

export function isAllowedUrl(url: string): boolean {
	if (url === BLANK_PAGE) return true;
	try {
		return WEB_PROTOCOLS.has(new URL(url).protocol);
	} catch {
		return false;
	}
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
	if (!isAllowedUrl(url.href)) throw new Error('Only http and https pages open in the browser.');
	return url.href;
}

function schemeFor(text: string): 'http:' | 'https:' {
	const host = text.split(/[/?#]/, 1)[0] ?? '';
	return PORT.test(host) || LOCAL_HOST.test(host) ? 'http:' : 'https:';
}
