const LAST_PAGE_PREFIX = 'malini.browser.last-page:v1:';

type PageStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readLastBrowserPage(
	workstreamId: string,
	storage: PageStorage | null = browserStorage(),
): string | null {
	try {
		const url = storage?.getItem(`${LAST_PAGE_PREFIX}${workstreamId}`) ?? null;
		return url && /^https?:\/\//u.test(url) ? url : null;
	} catch {
		return null;
	}
}

export function rememberBrowserPage(
	workstreamId: string,
	url: string,
	storage: PageStorage | null = browserStorage(),
): void {
	if (!/^https?:\/\//u.test(url)) return;
	try {
		storage?.setItem(`${LAST_PAGE_PREFIX}${workstreamId}`, url);
	} catch {}
}

function browserStorage(): PageStorage | null {
	return globalThis.localStorage ?? null;
}
