import { BROWSER_WORKTREE_SCHEME, type BrowserTabArgs } from '$contract/browser';

const LAST_PAGE_PREFIX = 'malini.browser.last-page:v2:';
const TABS_PREFIX = 'malini.browser.tabs:v1:';
const WEB_PAGE = new RegExp(`^(?:https?|${BROWSER_WORKTREE_SCHEME}):\\/\\/`, 'u');

type PageStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function readLastBrowserPage(
	tab: BrowserTabArgs,
	storage: PageStorage | null = browserStorage(),
): string | null {
	try {
		const url = storage?.getItem(pageKey(tab)) ?? null;
		return url && WEB_PAGE.test(url) ? url : null;
	} catch {
		return null;
	}
}

export function rememberBrowserPage(
	tab: BrowserTabArgs,
	url: string,
	storage: PageStorage | null = browserStorage(),
): void {
	if (!WEB_PAGE.test(url)) return;
	try {
		storage?.setItem(pageKey(tab), url);
	} catch {}
}

export function forgetBrowserPage(
	tab: BrowserTabArgs,
	storage: PageStorage | null = browserStorage(),
): void {
	try {
		storage?.removeItem(pageKey(tab));
	} catch {}
}

export function readBrowserTabs(
	workstreamId: string,
	storage: PageStorage | null = browserStorage(),
): readonly string[] {
	try {
		const value: unknown = JSON.parse(storage?.getItem(`${TABS_PREFIX}${workstreamId}`) ?? '[]');
		return Array.isArray(value)
			? value.filter((tabId): tabId is string => typeof tabId === 'string')
			: [];
	} catch {
		return [];
	}
}

export function saveBrowserTabs(
	workstreamId: string,
	tabIds: readonly string[],
	storage: PageStorage | null = browserStorage(),
): void {
	try {
		if (tabIds.length === 0) storage?.removeItem(`${TABS_PREFIX}${workstreamId}`);
		else storage?.setItem(`${TABS_PREFIX}${workstreamId}`, JSON.stringify(tabIds));
	} catch {}
}

function pageKey(tab: BrowserTabArgs): string {
	return `${LAST_PAGE_PREFIX}${tab.workstreamId}/${tab.tabId}`;
}

function browserStorage(): PageStorage | null {
	return globalThis.localStorage ?? null;
}
