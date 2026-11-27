import type { ExtensionPanelRegistration } from '@malini/extension-api';
import { mount, unmount } from 'svelte';
import type { BrowserTabArgs } from '$contract/browser';

import { closeBrowserTabCommand } from '../application/commands/close-browser-tab.command';
import { closeBrowserTabsCommand } from '../application/commands/close-browser-tabs.command';
import { browserStateQuery } from '../application/queries/browser-state.query.svelte';
import {
	BROWSER_DECK_PANEL_ID,
	browserTabKey,
	browserTabLabel,
	browserTabPanelId,
	type BrowserTab,
} from '../domain/browser-tab';
import type { OfferedVariants } from '../domain/variant-pages';
import BrowserDeck from './BrowserDeck.svelte';
import BrowserPanel from './BrowserPanel.svelte';

const BROWSER_TAB_ORDER = 30;
const registrations = new Map<string, ExtensionPanelRegistration>();

export function browserTabPanels(
	workstreamId: string,
	tabs: readonly BrowserTab[],
	offered: OfferedVariants,
	deck: boolean,
): readonly ExtensionPanelRegistration[] {
	const panels =
		deck && tabs.length > 0
			? [browserDeckPanel(workstreamId, offered)]
			: tabs.map(({ tabId }) => browserTabPanel({ workstreamId, tabId }, offered));
	const open = new Set(panels.map((panel) => registrationKey(workstreamId, panel.id)));
	for (const key of registrations.keys()) {
		if (key.startsWith(`${workstreamId}/`) && !open.has(key)) registrations.delete(key);
	}
	return panels;
}

function registrationKey(workstreamId: string, panelId: string): string {
	return `${workstreamId}/${panelId}`;
}

function browserDeckPanel(
	workstreamId: string,
	offered: OfferedVariants,
): ExtensionPanelRegistration {
	const key = registrationKey(workstreamId, BROWSER_DECK_PANEL_ID);
	const existing = registrations.get(key);
	if (existing) return existing;
	const registration: ExtensionPanelRegistration = {
		id: BROWSER_DECK_PANEL_ID,
		label: 'Browsers',
		icon: 'browser',
		order: BROWSER_TAB_ORDER,
		component: {
			workstreamScope: 'context',
			mount: (target) => {
				const deck = mount(BrowserDeck, { target, props: { workstreamId, offered } });
				return { dispose: () => unmount(deck) };
			},
		},
		onDidClose: () => closeBrowserTabsCommand(workstreamId),
	};
	registrations.set(key, registration);
	return registration;
}

function browserTabPanel(
	tab: BrowserTabArgs,
	offered: OfferedVariants,
): ExtensionPanelRegistration {
	const tabKey = browserTabKey(tab);
	const key = registrationKey(tab.workstreamId, browserTabPanelId(tab.tabId));
	const existing = registrations.get(key);
	if (existing) return existing;
	const registration: ExtensionPanelRegistration = {
		id: browserTabPanelId(tab.tabId),
		get label() {
			return browserTabLabel(browserStateQuery.data(tabKey));
		},
		get icon() {
			const favicon = browserStateQuery.data(tabKey)?.favicon;
			return favicon ? `image:${favicon}` : 'browser';
		},
		order: BROWSER_TAB_ORDER,
		component: {
			workstreamScope: 'context',
			mount: (target) => {
				const panel = mount(BrowserPanel, { target, props: { ...tab, offered } });
				return { dispose: () => unmount(panel) };
			},
		},
		onDidClose: () => closeBrowserTabCommand(tab),
	};
	registrations.set(key, registration);
	return registration;
}
