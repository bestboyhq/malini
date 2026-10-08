import { flushSync, mount, unmount } from 'svelte';
import { beforeEach, describe, expect, it } from 'vitest';

import ExtensionInspectorCompactHarness from './fixtures/ExtensionInspectorCompactHarness.svelte';
import {
	panelRegistration,
	CompactHarnessProps,
	RegistryHarnessProps,
} from './fixtures/extension-inspector-compact-harness.svelte';
import { INSPECTOR_DRAWER_STORAGE_KEY_PREFIX } from '$shared/extensions/inspector-drawer.store.svelte';
import {
	INSPECTOR_PANEL_PREFERENCES_KEY_PREFIX,
	INSPECTOR_PANEL_PREFERENCES_VERSION,
	REPOSITORY_CHANGES_PANEL_ID,
	REPOSITORY_FILES_PANEL_ID,
} from '$shared/extensions/inspector-panel-preferences';

const REGISTERED = [
	panelRegistration(REPOSITORY_FILES_PANEL_ID, 'Files'),
	panelRegistration(REPOSITORY_CHANGES_PANEL_ID, 'Changes'),
	panelRegistration('example.terminal.panel', 'Terminal'),
];

const CLOSED_DRAWER_WORKSTREAM_IDS = ['ws-1', 'ws-2'];

function recordDrawerClosed(workstreamId: string): void {
	globalThis.localStorage.setItem(
		`${INSPECTOR_DRAWER_STORAGE_KEY_PREFIX}${workstreamId}`,
		'closed',
	);
}

type Harness = Readonly<{
	host: HTMLElement;
	props: CompactHarnessProps;
	stop: () => void;
}>;

function render(props: CompactHarnessProps): Harness {
	const host = document.createElement('div');
	document.body.append(host);
	const app = mount(ExtensionInspectorCompactHarness, { target: host, props });
	flushSync();
	return {
		host,
		props,
		stop: () => {
			void unmount(app);
			host.remove();
		},
	};
}

function renderWithRegistry(
	props: RegistryHarnessProps,
	seed: (props: RegistryHarnessProps) => void,
): Readonly<{ host: HTMLElement; props: RegistryHarnessProps; stop: () => void }> {
	seed(props);
	const host = document.createElement('div');
	document.body.append(host);
	const app = mount(ExtensionInspectorCompactHarness, {
		target: host,
		props: {
			get workstreamId() {
				return props.workstreamId;
			},
			get workstreamName() {
				return props.workstreamName;
			},
			get storage() {
				return props.storage;
			},
			registry: props.registry,
		},
	});
	flushSync();
	return {
		host,
		props,
		stop: () => {
			void unmount(app);
			host.remove();
		},
	};
}

function compactRows(host: HTMLElement): HTMLButtonElement[] {
	return [
		...host.querySelectorAll<HTMLButtonElement>('[data-testid="extension-inspector-gutter-row"]'),
	];
}

function compactPanelIds(host: HTMLElement): string[] {
	return compactRows(host).map((row) => row.getAttribute('data-panel-id') ?? '');
}

function compactLabels(host: HTMLElement): string[] {
	return compactRows(host).map((row) => row.children[1]?.textContent?.trim() ?? '');
}

describe('the compact inspector', () => {
	beforeEach(() => {
		globalThis.localStorage?.clear();
		CLOSED_DRAWER_WORKSTREAM_IDS.forEach(recordDrawerClosed);
	});

	it('comes up open, with no compact list, on a workstream nobody has closed', () => {
		globalThis.localStorage.clear();
		const harness = render(
			new CompactHarnessProps({ workstreamName: 'Golden Circuit', panels: REGISTERED }),
		);

		expect(
			harness.host
				.querySelector('[data-testid="extension-inspector-shell"]')
				?.getAttribute('data-inspector-drawer-open'),
		).toBe('true');
		expect(harness.host.querySelector('[data-testid="extension-inspector-gutter"]')).toBeNull();
		expect(
			harness.host
				.querySelector('[data-testid="extension-inspector-tab"][aria-selected="true"]')
				?.getAttribute('data-panel-id'),
		).toBe(REPOSITORY_FILES_PANEL_ID);

		harness.stop();
	});

	it('lists the workstream panels on first paint, with the drawer closed', () => {
		const harness = render(
			new CompactHarnessProps({
				workstreamName: 'Golden Circuit',
				panels: REGISTERED,
			}),
		);

		expect(harness.host.querySelector('[data-testid="extension-inspector-gutter"]')).not.toBeNull();
		expect(compactPanelIds(harness.host)).toEqual([
			REPOSITORY_FILES_PANEL_ID,
			REPOSITORY_CHANGES_PANEL_ID,
			'example.terminal.panel',
		]);
		expect(compactLabels(harness.host)).toEqual(['Files', 'Changes', 'Terminal']);
		expect(harness.host.textContent).toContain('On Golden Circuit');
		expect(compactRows(harness.host).every((row) => !row.disabled)).toBe(true);

		harness.stop();
	});

	it('picks up contributions that register after the first frame', () => {
		const harness = render(new CompactHarnessProps({ panels: [] }));
		expect(compactPanelIds(harness.host)).toEqual([]);

		harness.props.panels = REGISTERED;
		flushSync();

		expect(compactLabels(harness.host)).toEqual(['Files', 'Changes', 'Terminal']);
		harness.stop();
	});

	it('lists a panel an extension contributes through the real registry', () => {
		const harness = renderWithRegistry(
			new RegistryHarnessProps({ workstreamName: 'Golden Circuit' }),
			(props) => props.register(panelRegistration(REPOSITORY_CHANGES_PANEL_ID, 'Changes')),
		);
		expect(compactPanelIds(harness.host)).toEqual([REPOSITORY_CHANGES_PANEL_ID]);

		harness.props.register(panelRegistration(REPOSITORY_FILES_PANEL_ID, 'Files'));
		flushSync();

		expect(compactPanelIds(harness.host)).toEqual([
			REPOSITORY_FILES_PANEL_ID,
			REPOSITORY_CHANGES_PANEL_ID,
		]);
		expect(compactLabels(harness.host)).toEqual(['Files', 'Changes']);
		harness.stop();
	});

	it('lists a panel that is registered but not open, and opens it on click', () => {
		globalThis.localStorage.setItem(
			`${INSPECTOR_PANEL_PREFERENCES_KEY_PREFIX}ws-1`,
			JSON.stringify({
				version: INSPECTOR_PANEL_PREFERENCES_VERSION,
				order: [REPOSITORY_FILES_PANEL_ID, REPOSITORY_CHANGES_PANEL_ID],
				hidden: [REPOSITORY_CHANGES_PANEL_ID],
				activeId: REPOSITORY_FILES_PANEL_ID,
			}),
		);

		const harness = render(new CompactHarnessProps({ panels: REGISTERED }));

		expect(compactPanelIds(harness.host)).toEqual([
			REPOSITORY_FILES_PANEL_ID,
			REPOSITORY_CHANGES_PANEL_ID,
			'example.terminal.panel',
		]);
		const changes = harness.host.querySelector<HTMLButtonElement>(
			`[data-testid="extension-inspector-gutter-row"][data-panel-id="${REPOSITORY_CHANGES_PANEL_ID}"]`,
		);
		expect(changes?.getAttribute('data-panel-closed')).toBe('true');
		expect(
			changes?.querySelector('[data-testid="extension-inspector-gutter-closed"]'),
		).not.toBeNull();
		expect(
			harness.host
				.querySelector(
					`[data-testid="extension-inspector-gutter-row"][data-panel-id="${REPOSITORY_FILES_PANEL_ID}"]`,
				)
				?.getAttribute('data-panel-closed'),
		).toBe('false');

		changes?.click();
		flushSync();

		expect(
			harness.host.querySelector(
				`[data-testid="extension-inspector-tab"][data-panel-id="${REPOSITORY_CHANGES_PANEL_ID}"]`,
			),
		).not.toBeNull();
		harness.stop();
	});

	it('offers exactly what the open inspector offers, closed or not', () => {
		globalThis.localStorage.setItem(
			`${INSPECTOR_PANEL_PREFERENCES_KEY_PREFIX}ws-1`,
			JSON.stringify({
				version: INSPECTOR_PANEL_PREFERENCES_VERSION,
				order: [REPOSITORY_CHANGES_PANEL_ID, REPOSITORY_FILES_PANEL_ID],
				hidden: [REPOSITORY_FILES_PANEL_ID, 'example.terminal.panel'],
				activeId: REPOSITORY_CHANGES_PANEL_ID,
			}),
		);
		const harness = render(new CompactHarnessProps({ panels: REGISTERED }));
		const listed = [...compactPanelIds(harness.host)].sort();

		harness.host
			.querySelector<HTMLButtonElement>('[data-testid="extension-inspector-gutter-row"]')
			?.click();
		flushSync();
		harness.host
			.querySelector<HTMLButtonElement>('[data-testid="extension-inspector-add"]')
			?.click();
		flushSync();

		const offered = [
			...document.querySelectorAll('[data-testid="extension-inspector-picker-item"]'),
		]
			.map((item) => item.getAttribute('data-panel-id') ?? '')
			.sort();

		expect(offered).not.toEqual([]);
		expect(listed).toEqual(offered);
		harness.stop();
	});

	it('keeps an unread worktree distinct from a clean one on the files row', () => {
		const unread = render(new CompactHarnessProps({ panels: REGISTERED }));
		expect(
			unread.host.querySelectorAll('[data-testid="extension-inspector-gutter-diffstat"]'),
		).toHaveLength(0);
		unread.stop();

		const clean = render(
			new CompactHarnessProps({
				panels: REGISTERED,
				changeTotals: { additions: 0, deletions: 0 },
			}),
		);
		const diffstats = clean.host.querySelectorAll(
			'[data-testid="extension-inspector-gutter-diffstat"]',
		);
		expect(diffstats).toHaveLength(1);
		expect(diffstats[0]?.getAttribute('aria-label')).toBe('No changes');
		clean.stop();

		const dirty = render(
			new CompactHarnessProps({
				panels: REGISTERED,
				changeTotals: { additions: 1265, deletions: 667 },
			}),
		);
		expect(
			dirty.host
				.querySelector('[data-testid="extension-inspector-gutter-diffstat"]')
				?.getAttribute('aria-label'),
		).toBe(`${new Intl.NumberFormat().format(1265)} additions, 667 deletions`);
		dirty.stop();
	});

	it('opens the drawer through the inspector when a row is clicked', () => {
		const harness = render(
			new CompactHarnessProps({ workstreamName: 'Golden Circuit', panels: REGISTERED }),
		);
		const shell = harness.host.querySelector('[data-testid="extension-inspector-shell"]');
		expect(shell?.getAttribute('data-inspector-drawer-open')).toBe('false');

		harness.host
			.querySelector<HTMLButtonElement>(
				`[data-testid="extension-inspector-gutter-row"][data-panel-id="${REPOSITORY_FILES_PANEL_ID}"]`,
			)
			?.click();
		flushSync();

		expect(shell?.getAttribute('data-inspector-drawer-open')).toBe('true');
		expect(harness.host.querySelector('[data-testid="extension-inspector-gutter"]')).toBeNull();
		expect(
			harness.host.querySelector(
				`[data-testid="extension-inspector-tab"][data-panel-id="${REPOSITORY_FILES_PANEL_ID}"]`,
			),
		).not.toBeNull();

		harness.stop();
	});
});
