import { describe, expect, it } from 'vitest';
import {
	readBrowserDeck,
	readBrowserTabs,
	readLastBrowserPage,
	rememberBrowserPage,
	saveBrowserDeck,
	saveBrowserTabs,
} from './browser-pages.storage';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
	const items = new Map<string, string>();
	return {
		getItem: (key) => items.get(key) ?? null,
		setItem: (key, value) => void items.set(key, value),
		removeItem: (key) => void items.delete(key),
	};
}

describe('browser pages storage', () => {
	it('remembers web pages and worktree files, and nothing else', () => {
		const storage = memoryStorage();
		const tab = { workstreamId: 'ws-1', tabId: 'tab-1' };
		for (const url of ['http://localhost:5173/', 'malini-worktree://ws-1/docs/report.html']) {
			rememberBrowserPage(tab, url, storage);
			expect(readLastBrowserPage(tab, storage)).toBe(url);
		}
		rememberBrowserPage(tab, 'about:blank', storage);
		expect(readLastBrowserPage(tab, storage)).toBe('malini-worktree://ws-1/docs/report.html');
	});

	it('keeps each tab with its profile, reads tabs saved before profiles as default, and drops broken ones', () => {
		const storage = memoryStorage();
		storage.setItem('malini.browser.tabs:v1:ws-1', JSON.stringify(['old', { tabId: 'x' }, 7]));
		expect(readBrowserTabs('ws-1', storage)).toEqual([{ tabId: 'old', profile: 'default' }]);

		const tabs = [
			{ tabId: 'old', profile: 'default' },
			{ tabId: 'cats', profile: 'reddit-cats' },
		];
		saveBrowserTabs('ws-1', tabs, storage);
		expect(readBrowserTabs('ws-1', storage)).toEqual(tabs);
		saveBrowserTabs('ws-1', [], storage);
		expect(readBrowserTabs('ws-1', storage)).toEqual([]);
	});

	it('remembers whether browsers show side by side', () => {
		const storage = memoryStorage();
		expect(readBrowserDeck(storage)).toBe(false);
		saveBrowserDeck(true, storage);
		expect(readBrowserDeck(storage)).toBe(true);
		saveBrowserDeck(false, storage);
		expect(readBrowserDeck(storage)).toBe(false);
	});
});
