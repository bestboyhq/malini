import type { ExtensionPanelRegistration } from '@malini/extension-api';
import { mount, unmount } from 'svelte';
import type { BrowserTabArgs } from '$contract/browser';

import { closeBrowserTabCommand } from '../application/commands/close-browser-tab.command';
import { browserStateQuery } from '../application/queries/browser-state.query.svelte';
import { browserTabKey, browserTabLabel, browserTabPanelId } from '../domain/browser-tab';
import type { OfferedVariants } from '../domain/variant-pages';
import BrowserPanel from './BrowserPanel.svelte';

const BROWSER_TAB_ORDER = 30;
const registrations = new Map<string, ExtensionPanelRegistration>();

export function browserTabPanels(
	workstreamId: string,
	tabIds: readonly string[],
	offered: OfferedVariants,
): readonly ExtensionPanelRegistration[] {
	const open = new Set(tabIds.map((tabId) => browserTabKey({ workstreamId, tabId })));
	for (const key of registrations.keys()) {
		if (key.startsWith(`${workstreamId}/`) && !open.has(key)) registrations.delete(key);
	}
	return tabIds.map((tabId) => browserTabPanel({ workstreamId, tabId }, offered));
}

function browserTabPanel(
	tab: BrowserTabArgs,
	offered: OfferedVariants,
): ExtensionPanelRegistration {
	const key = browserTabKey(tab);
	const existing = registrations.get(key);
	if (existing) return existing;
	const registration: ExtensionPanelRegistration = {
		id: browserTabPanelId(tab.tabId),
		get label() {
			return browserTabLabel(browserStateQuery.data(key));
		},
		get icon() {
			const favicon = browserStateQuery.data(key)?.favicon;
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
