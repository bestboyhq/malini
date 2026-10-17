import type { ExtensionPanelContext, ExtensionPanelRegistration } from '@malini/extension-api';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserState } from '$contract/browser';
import { BROWSER_STATE_CHANGED_CHANNEL, BROWSER_TAB_OPENED_CHANNEL } from '$contract/events';
import ExtensionInspectorShell from '$lib/extensions/presentation/ExtensionInspectorShell.svelte';
import {
	INSPECTOR_PANEL_PREFERENCES_KEY_PREFIX,
	INSPECTOR_PANEL_PREFERENCES_VERSION,
	REPOSITORY_CHANGES_PANEL_ID,
	REPOSITORY_FILES_PANEL_ID,
} from '$shared/extensions/inspector-panel-preferences';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';

import { loadBrowserTabsCommand } from '../application/commands/load-browser-tabs.command';
import { openBrowserTabCommand } from '../application/commands/open-browser-tab.command';
import { revealOpenedBrowserHook } from '../application/hooks/reveal-opened-browser.hook';
import { watchBrowserStateHook } from '../application/hooks/watch-browser-state.hook';
import { browserTabsQuery } from '../application/queries/browser-tabs.query.svelte';
import { browserTabPanels } from './browser-inspector-panel';

const FAVICON = 'data:image/png;base64,AA==';

let workstreamId = '';
let nextWorkstream = 0;
let platform: FakePlatform;
let stops: Array<() => void> = [];

beforeEach(() => {
	globalThis.localStorage.clear();
	platform = createFakePlatform();
	setPlatformForTest(platform);
	nextWorkstream += 1;
	workstreamId = `ws-browser-tabs-${nextWorkstream}`;
	stops = [revealOpenedBrowserHook(), watchBrowserStateHook()];
});

afterEach(() => {
	for (const stop of stops.splice(0)) stop();
	setPlatformForTest(null);
});

describe('browser tabs in the inspector', () => {
	it('lists no browser tab until one opens, then shows the agent tab by its title and favicon', async () => {
		globalThis.localStorage.setItem(
			`${INSPECTOR_PANEL_PREFERENCES_KEY_PREFIX}${workstreamId}`,
			JSON.stringify({
				version: INSPECTOR_PANEL_PREFERENCES_VERSION,
				order: [REPOSITORY_CHANGES_PANEL_ID, REPOSITORY_FILES_PANEL_ID],
				hidden: [REPOSITORY_CHANGES_PANEL_ID],
				activeId: REPOSITORY_FILES_PANEL_ID,
			}),
		);
		const host = render([
			contextPanel(REPOSITORY_FILES_PANEL_ID, 'Files', 20),
			contextPanel(REPOSITORY_CHANGES_PANEL_ID, 'Changes', 10),
		]);
		await settle();
		expect(tabs(host)).toEqual([{ name: 'Files', selected: true }]);

		const agentTab = { workstreamId, tabId: 'chat-session-1' };
		platform.emit(BROWSER_TAB_OPENED_CHANNEL, agentTab);
		await settle();
		platform.emit(BROWSER_STATE_CHANGED_CHANNEL, page(agentTab, 'Lobby music'));
		await settle();

		expect(tabs(host)).toEqual([
			{ name: 'Files', selected: false },
			{ name: 'Lobby music', selected: true },
		]);
		const favicon = tab(host, 'Lobby music').querySelector('img');
		expect(favicon?.getAttribute('src')).toBe(FAVICON);
		expect(document.activeElement?.getAttribute('aria-label')).not.toBe('Page address');
	});

	it('puts the cursor in the address field of a tab opened from the plus menu', async () => {
		const host = render([contextPanel(REPOSITORY_FILES_PANEL_ID, 'Files', 20)]);
		await settle();

		control(document.body, 'button', 'Open inspector panel').click();
		await settle();
		control(document.body, '[role="menuitem"]', 'New browser tab').click();

		await vi.waitFor(() => expect(host.textContent).toContain('Open a page'));
		await settle();
		const address = control(host, 'input', 'Page address');
		expect(document.activeElement).toBe(address);
	});

	it('opens a new tab from the plus menu each time and closes only the tab closed', async () => {
		const host = render([contextPanel(REPOSITORY_FILES_PANEL_ID, 'Files', 20)]);
		await settle();

		for (let opened = 0; opened < 2; opened += 1) {
			control(document.body, 'button', 'Open inspector panel').click();
			await settle();
			control(document.body, '[role="menuitem"]', 'New browser tab').click();
			await settle();
		}

		expect(tabs(host)).toEqual([
			{ name: 'Files', selected: false },
			{ name: 'New tab', selected: false },
			{ name: 'New tab', selected: true },
		]);
		await vi.waitFor(() => expect(host.textContent).toContain('Open a page'));
		const [first, second] = browserTabsQuery.data(workstreamId);

		const closes = host.querySelectorAll<HTMLElement>('button[aria-label="Close New tab"]');
		closes[1]?.click();
		await settle();

		expect(tabs(host)).toEqual([
			{ name: 'Files', selected: false },
			{ name: 'New tab', selected: true },
		]);
		expect(browserTabsQuery.data(workstreamId)).toEqual([first]);
		await vi.waitFor(() =>
			expect(platform.calls).toContainEqual({
				command: 'browser.close',
				args: { workstreamId, tabId: second },
			}),
		);
	});
});

function render(fixed: readonly ExtensionPanelRegistration[]): HTMLElement {
	loadBrowserTabsCommand(workstreamId);
	const context: ExtensionPanelContext = {
		workstream: {
			id: workstreamId,
			path: `/tmp/${workstreamId}`,
			repositoryPath: `/tmp/${workstreamId}`,
			branch: 'feature',
			baseBranch: 'main',
		},
		settings: {},
		executeCommand: () => Promise.reject(new Error('No extension host in this test')),
	};
	const props = $state({
		workstreamId,
		context,
		ready: true,
		panels: fixed,
		panelActions: [
			{
				id: 'new-browser-tab',
				label: 'New browser tab',
				icon: 'browser',
				run: () => openBrowserTabCommand(workstreamId),
			},
		],
	});
	const stopPanels = $effect.root(() => {
		$effect(() => {
			props.panels = [
				...fixed,
				...browserTabPanels(workstreamId, browserTabsQuery.data(workstreamId), () => undefined),
			];
		});
	});
	const host = document.createElement('div');
	document.body.append(host);
	const app = mount(ExtensionInspectorShell, { target: host, props });
	flushSync();
	stops.push(() => {
		stopPanels();
		void unmount(app);
		host.remove();
	});
	return host;
}

function page(tab: Readonly<{ workstreamId: string; tabId: string }>, title: string): BrowserState {
	return {
		...tab,
		url: 'https://music.example/lobby',
		title,
		favicon: FAVICON,
		loading: false,
		canGoBack: false,
		canGoForward: false,
	};
}

function contextPanel(id: string, label: string, order: number): ExtensionPanelRegistration {
	return {
		id,
		label,
		icon: 'files',
		order,
		component: {
			workstreamScope: 'context',
			mount: (target) => {
				const node = target.ownerDocument.createElement('p');
				node.textContent = label;
				target.append(node);
				return { dispose: () => node.remove() };
			},
		},
	};
}

function tabs(host: HTMLElement): ReadonlyArray<Readonly<{ name: string; selected: boolean }>> {
	return [...host.querySelectorAll('[role="tab"]')].map((element) => ({
		name: element.textContent?.trim() ?? '',
		selected: element.getAttribute('aria-selected') === 'true',
	}));
}

function tab(host: HTMLElement, name: string): HTMLElement {
	const found = [...host.querySelectorAll<HTMLElement>('[role="tab"]')].find(
		(element) => element.textContent?.trim() === name,
	);
	if (!found) throw new Error(`No ${name} tab`);
	return found;
}

function control(root: HTMLElement, selector: string, name: string): HTMLElement {
	const found = [...root.querySelectorAll<HTMLElement>(selector)].find(
		(element) =>
			element.getAttribute('aria-label') === name || element.textContent?.trim() === name,
	);
	if (!found) throw new Error(`No ${name} control`);
	return found;
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 6; turn += 1) {
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		flushSync();
	}
}
