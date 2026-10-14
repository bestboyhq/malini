import type { BrowserState, BrowserTabArgs } from '$contract/browser';
import { browserAddressLabel } from './browser-address';

export const BROWSER_TAB_PANEL_PREFIX = 'malini.browser.tab:';

export function browserTabKey(tab: BrowserTabArgs): string {
	return `${tab.workstreamId}/${tab.tabId}`;
}

export function browserTabPanelId(tabId: string): string {
	return `${BROWSER_TAB_PANEL_PREFIX}${tabId}`;
}

export function browserTabLabel(state: BrowserState | null): string {
	const title = state?.title.trim() ?? '';
	if (title) return title;
	return state?.url ? browserAddressLabel(state.url) : 'New tab';
}
