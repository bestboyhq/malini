import type { ExtensionPanelContext, ExtensionPanelRegistration } from '@malini/extension-api';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExtensionInspectorShell from '$lib/extensions/presentation/ExtensionInspectorShell.svelte';
import {
	INSPECTOR_PANEL_PREFERENCES_KEY_PREFIX,
	INSPECTOR_PANEL_PREFERENCES_VERSION,
	REPOSITORY_CHANGES_PANEL_ID,
	REPOSITORY_FILES_PANEL_ID,
} from '$shared/extensions/inspector-panel-preferences';
import { BROWSER_PAGE_OPENED_CHANNEL } from '$contract/events';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';

import { revealOpenedBrowserHook } from '../application/hooks/reveal-opened-browser.hook';
import { browserInspectorPanel } from './browser-inspector-panel';

const WORKSTREAM_ID = 'ws-browser-tab';

const CONTEXT: ExtensionPanelContext = {
	workstream: {
		id: WORKSTREAM_ID,
		path: `/tmp/${WORKSTREAM_ID}`,
		repositoryPath: `/tmp/${WORKSTREAM_ID}`,
		branch: 'feature',
		baseBranch: 'main',
	},
	settings: {},
	executeCommand: () => Promise.reject(new Error('No extension host in this test')),
};

let stop: () => void = () => undefined;
let platform: FakePlatform;

beforeEach(() => {
	globalThis.localStorage.clear();
	platform = createFakePlatform();
	setPlatformForTest(platform);
});

afterEach(() => {
	stop();
	setPlatformForTest(null);
});

describe('the Browser inspector tab', () => {
	it('stays out of the inspector until a page opens, then joins after the panels the user arranged', async () => {
		globalThis.localStorage.setItem(
			`${INSPECTOR_PANEL_PREFERENCES_KEY_PREFIX}${WORKSTREAM_ID}`,
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
			browserInspectorPanel({ onElementPrompt: () => undefined }),
		]);
		const stopRevealing = revealOpenedBrowserHook();
		await settle();
		expect(tabs(host)).toEqual([{ name: 'Files', selected: true }]);

		platform.emit(BROWSER_PAGE_OPENED_CHANNEL, { workstreamId: WORKSTREAM_ID });
		await settle();
		expect(tabs(host)).toEqual([
			{ name: 'Files', selected: false },
			{ name: 'Browser', selected: true },
		]);

		tab(host, 'Files').click();
		platform.emit(BROWSER_PAGE_OPENED_CHANNEL, { workstreamId: WORKSTREAM_ID });
		await settle();
		stopRevealing();
		expect(tabs(host)).toEqual([
			{ name: 'Files', selected: true },
			{ name: 'Browser', selected: false },
		]);
	});

	it('opens from the plus menu with its address field, and closing the tab closes the page', async () => {
		const host = render([
			contextPanel(REPOSITORY_FILES_PANEL_ID, 'Files', 20),
			browserInspectorPanel({ onElementPrompt: () => undefined }),
		]);
		await settle();

		button(document.body, 'Open inspector panel').click();
		await settle();
		button(document.body, 'Open Browser', '[role="menuitem"]').click();
		await settle();

		expect(tabs(host)).toEqual([
			{ name: 'Files', selected: false },
			{ name: 'Browser', selected: true },
		]);
		await vi.waitFor(() => expect(host.textContent).toContain('Open a page'));
		expect(host.querySelector('input[aria-label="Page address"]')).not.toBeNull();

		button(host, 'Close Browser').click();
		await settle();

		expect(tabs(host)).toEqual([{ name: 'Files', selected: true }]);
		await vi.waitFor(() =>
			expect(platform.calls).toContainEqual({
				command: 'browser.close',
				args: { workstreamId: WORKSTREAM_ID },
			}),
		);
	});
});

function render(panels: readonly ExtensionPanelRegistration[]): HTMLElement {
	const host = document.createElement('div');
	document.body.append(host);
	const app = mount(ExtensionInspectorShell, {
		target: host,
		props: { workstreamId: WORKSTREAM_ID, panels, context: CONTEXT, ready: true },
	});
	flushSync();
	stop = () => {
		void unmount(app);
		host.remove();
		stop = () => undefined;
	};
	return host;
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

function button(root: HTMLElement, name: string, selector = 'button'): HTMLElement {
	const found = [...root.querySelectorAll<HTMLElement>(selector)].find(
		(element) => element.getAttribute('aria-label') === name,
	);
	if (!found) throw new Error(`No ${name} control`);
	return found;
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 4; turn += 1) {
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		flushSync();
	}
}
