import type { BrowserState, BrowserTabArgs } from '$contract/browser';
import { browserAddressLabel } from './browser-address';

export const BROWSER_TAB_PANEL_PREFIX = 'malini.browser.tab:';
export const BROWSER_DECK_PANEL_ID = 'malini.browser.deck';

export type BrowserTab = Readonly<{ tabId: string; profile: string }>;

export function browserTabKey(tab: BrowserTabArgs): string {
	return `${tab.workstreamId}/${tab.tabId}`;
}

export function browserTabPanelId(tabId: string): string {
	return `${BROWSER_TAB_PANEL_PREFIX}${tabId}`;
}

export function browserPanelId(tabId: string, deck: boolean): string {
	return deck ? BROWSER_DECK_PANEL_ID : browserTabPanelId(tabId);
}

export function browserTabLabel(state: BrowserState | null): string {
	const title = state?.title.trim() ?? '';
	if (title && title !== state?.url) return title;
	return state?.url ? browserAddressLabel(state.url) : 'New tab';
}
