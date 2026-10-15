import { describe, expect, it } from 'vitest';
import { readLastBrowserPage, rememberBrowserPage } from './browser-pages.storage';

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
});
