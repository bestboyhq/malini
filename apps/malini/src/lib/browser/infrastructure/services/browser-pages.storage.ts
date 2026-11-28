import {
	BROWSER_WORKTREE_SCHEME,
	DEFAULT_BROWSER_PROFILE,
	browserProfileName,
	type BrowserTabArgs,
} from '$contract/browser';
import type { BrowserTab } from '../../domain/browser-tab';

const LAST_PAGE_PREFIX = 'malini.browser.last-page:v2:';
const TABS_PREFIX = 'malini.browser.tabs:v1:';
const DECK_KEY = 'malini.browser.deck:v1';
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
): readonly BrowserTab[] {
	try {
		const value: unknown = JSON.parse(storage?.getItem(`${TABS_PREFIX}${workstreamId}`) ?? '[]');
		return Array.isArray(value) ? value.flatMap(storedTab) : [];
	} catch {
		return [];
	}
}

export function saveBrowserTabs(
	workstreamId: string,
	tabs: readonly BrowserTab[],
	storage: PageStorage | null = browserStorage(),
): void {
	try {
		if (tabs.length === 0) storage?.removeItem(`${TABS_PREFIX}${workstreamId}`);
		else storage?.setItem(`${TABS_PREFIX}${workstreamId}`, JSON.stringify(tabs));
	} catch {}
}

export function readBrowserDeck(storage: PageStorage | null = browserStorage()): boolean {
	try {
		return storage?.getItem(DECK_KEY) === 'on';
	} catch {
		return false;
	}
}

export function saveBrowserDeck(on: boolean, storage: PageStorage | null = browserStorage()): void {
	try {
		if (on) storage?.setItem(DECK_KEY, 'on');
		else storage?.removeItem(DECK_KEY);
	} catch {}
}

function storedTab(value: unknown): BrowserTab[] {
	if (typeof value === 'string') return [{ tabId: value, profile: DEFAULT_BROWSER_PROFILE }];
	if (typeof value !== 'object' || value === null) return [];
	if (!('tabId' in value) || !('profile' in value)) return [];
	const { tabId, profile } = value;
	if (typeof tabId !== 'string' || typeof profile !== 'string') return [];
	const name = browserProfileName(profile);
	return name === null ? [] : [{ tabId, profile: name }];
}

function pageKey(tab: BrowserTabArgs): string {
	return `${LAST_PAGE_PREFIX}${tab.workstreamId}/${tab.tabId}`;
}

function browserStorage(): PageStorage | null {
	return globalThis.localStorage ?? null;
}
