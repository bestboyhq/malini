import { BROWSER_WORKTREE_SCHEME } from '$contract/browser';

export function browserAddressLabel(address: string): string {
	try {
		const url = new URL(address);
		if (url.protocol === `${BROWSER_WORKTREE_SCHEME}:`) {
			return `.${decodeURIComponent(url.pathname)}${url.search}${url.hash}`;
		}
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return address;
		const path = url.pathname === '/' ? '' : url.pathname;
		return `${url.host}${path}${url.search}${url.hash}`;
	} catch {
		return address;
	}
}
