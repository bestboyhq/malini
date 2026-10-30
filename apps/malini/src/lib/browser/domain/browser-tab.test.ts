import { describe, expect, it } from 'vitest';
import type { BrowserState } from '$contract/browser';
import { browserTabLabel } from './browser-tab';

const page = (url: string, title: string): BrowserState => ({
	workstreamId: 'ws-1',
	tabId: 't1',
	url,
	title,
	favicon: null,
	loading: false,
	canGoBack: false,
	canGoForward: false,
	failure: null,
});

describe('browser tab label', () => {
	it('names a tab by its page title, and by its address when the page has none', () => {
		const address = 'malini-worktree://ws-1/.context/brag/a-share-first.html';
		expect(browserTabLabel(page(address, 'Share first'))).toBe('Share first');
		expect(browserTabLabel(page(address, address))).toBe('./.context/brag/a-share-first.html');
		expect(browserTabLabel(null)).toBe('New tab');
	});
});
