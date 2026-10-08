import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';

import {
	INSPECTOR_DRAWER_STORAGE_KEY_PREFIX,
	inspectorDrawer,
	loadInspectorDrawerOpen,
	saveInspectorDrawerOpen,
} from './inspector-drawer.store.svelte';

function memoryStorage(seed: Record<string, string> = {}) {
	const values = new Map(Object.entries(seed));
	return {
		values,
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
	};
}

describe('inspector drawer state', () => {
	it('is open on a workstream the user has never closed it on', () => {
		const storage = memoryStorage();

		expect(loadInspectorDrawerOpen('workstream-1', storage)).toBe(true);
		expect(inspectorDrawer.isOpen('workstream-1', storage)).toBe(true);
	});

	it('writes nothing until the user disagrees with the default', () => {
		const storage = memoryStorage();

		inspectorDrawer.isOpen('workstream-1', storage);
		expect([...storage.values.keys()]).toEqual([]);

		inspectorDrawer.open('workstream-1', storage);
		expect([...storage.values.keys()]).toEqual([]);
	});

	it('closes on an explicit request and keeps that choice for the workstream', () => {
		const storage = memoryStorage();

		inspectorDrawer.close('workstream-1', storage);

		expect(inspectorDrawer.isOpen('workstream-1', storage)).toBe(false);
		expect(storage.getItem(`${INSPECTOR_DRAWER_STORAGE_KEY_PREFIX}workstream-1`)).toBe('closed');
		expect(loadInspectorDrawerOpen('workstream-1', storage)).toBe(false);
	});

	it('keeps the decision per workstream instead of leaking it to the next one', () => {
		const storage = memoryStorage();

		inspectorDrawer.close('workstream-1', storage);

		expect(inspectorDrawer.isOpen('workstream-2', storage)).toBe(true);
	});

	it('records a reopen so a closed workstream comes back open', () => {
		const storage = memoryStorage();

		inspectorDrawer.close('workstream-1', storage);
		inspectorDrawer.open('workstream-1', storage);

		expect(inspectorDrawer.isOpen('workstream-1', storage)).toBe(true);
		expect(storage.getItem(`${INSPECTOR_DRAWER_STORAGE_KEY_PREFIX}workstream-1`)).toBe('open');
		expect(loadInspectorDrawerOpen('workstream-1', storage)).toBe(true);
	});

	it('honors a close recorded before the default changed', () => {
		const closed = memoryStorage({
			[`${INSPECTOR_DRAWER_STORAGE_KEY_PREFIX}workstream-1`]: 'closed',
		});
		const opened = memoryStorage({
			[`${INSPECTOR_DRAWER_STORAGE_KEY_PREFIX}workstream-1`]: 'open',
		});

		expect(loadInspectorDrawerOpen('workstream-1', closed)).toBe(false);
		expect(loadInspectorDrawerOpen('workstream-1', opened)).toBe(true);
	});

	it('toggles from whatever is written down', () => {
		const storage = memoryStorage();

		inspectorDrawer.toggle('workstream-1', storage);
		expect(inspectorDrawer.isOpen('workstream-1', storage)).toBe(false);

		inspectorDrawer.toggle('workstream-1', storage);
		expect(inspectorDrawer.isOpen('workstream-1', storage)).toBe(true);
	});

	it('stays usable when persistence is unavailable', () => {
		const failing = {
			getItem: () => {
				throw new Error('denied');
			},
			setItem: () => {
				throw new Error('denied');
			},
		};

		expect(loadInspectorDrawerOpen('workstream-1', failing)).toBe(true);
		expect(() => saveInspectorDrawerOpen('workstream-1', true, failing)).not.toThrow();
		expect(inspectorDrawer.isOpen('workstream-1', null)).toBe(true);
	});
});

describe('inspector split wiring', () => {
	const split = readFileSync(
		new URL('../../extensions/presentation/InspectorSplit.svelte', import.meta.url),
		'utf8',
	);

	it('hands the transcript its width back when the drawer is closed or floats over it', () => {
		expect(split).toContain(
			"import { inspectorDrawer } from '$shared/extensions/inspector-drawer.store.svelte'",
		);
		expect(split).toContain(
			'const secondaryOpen = $derived(inspectorDrawer.isOpen(workstreamId) && !inspectorDrawer.overlay)',
		);
		expect(split).toContain('{secondaryOpen}');
	});
});
