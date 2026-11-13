import { describe, expect, it } from 'vitest';

import {
	INSPECTOR_DRAWER_STORAGE_KEY_PREFIX,
	InspectorDrawer,
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
	it('is closed on a workstream the user has never opened it on', () => {
		const storage = memoryStorage();

		expect(loadInspectorDrawerOpen('workstream-1', storage)).toBe(false);
		expect(inspectorDrawer.isOpen('workstream-1', storage)).toBe(false);
	});

	it('writes nothing until the user disagrees with the default', () => {
		const storage = memoryStorage();

		inspectorDrawer.isOpen('workstream-1', storage);
		inspectorDrawer.close('workstream-1', storage);
		expect([...storage.values.keys()]).toEqual([]);

		inspectorDrawer.open('workstream-1', storage);
		expect(storage.getItem(`${INSPECTOR_DRAWER_STORAGE_KEY_PREFIX}workstream-1`)).toBe('open');
	});

	it('closes on an explicit request and keeps that choice for the workstream', () => {
		const storage = memoryStorage();

		inspectorDrawer.open('workstream-1', storage);
		inspectorDrawer.close('workstream-1', storage);

		expect(inspectorDrawer.isOpen('workstream-1', storage)).toBe(false);
		expect(storage.getItem(`${INSPECTOR_DRAWER_STORAGE_KEY_PREFIX}workstream-1`)).toBe('closed');
		expect(loadInspectorDrawerOpen('workstream-1', storage)).toBe(false);
	});

	it('reopens by itself after folding for lack of panels, but stays closed once the user closed it', () => {
		const storage = memoryStorage();

		inspectorDrawer.fold('workstream-1', storage);
		inspectorDrawer.unfold('workstream-1', storage);
		expect(inspectorDrawer.isOpen('workstream-1', storage)).toBe(false);

		inspectorDrawer.open('workstream-1', storage);
		inspectorDrawer.fold('workstream-1', storage);
		expect(inspectorDrawer.isOpen('workstream-1', storage)).toBe(false);
		inspectorDrawer.unfold('workstream-1', storage);
		expect(inspectorDrawer.isOpen('workstream-1', storage)).toBe(true);

		inspectorDrawer.close('workstream-1', storage);
		inspectorDrawer.fold('workstream-1', storage);
		inspectorDrawer.unfold('workstream-1', storage);
		expect(inspectorDrawer.isOpen('workstream-1', storage)).toBe(false);
	});

	it('reopens the overlay by itself after folding for lack of panels, but not once closed', () => {
		const storage = memoryStorage();
		const overlay = new InspectorDrawer(() => true);

		overlay.open('workstream-1', storage);
		overlay.fold('workstream-1', storage);
		expect(overlay.isOpen('workstream-1', storage)).toBe(false);
		overlay.unfold('workstream-1', storage);
		expect(overlay.isOpen('workstream-1', storage)).toBe(true);

		overlay.close('workstream-1', storage);
		overlay.fold('workstream-1', storage);
		overlay.unfold('workstream-1', storage);
		expect(overlay.isOpen('workstream-1', storage)).toBe(false);
		expect([...storage.values.keys()]).toEqual([]);
	});

	it('keeps the decision per workstream instead of leaking it to the next one', () => {
		const storage = memoryStorage();

		inspectorDrawer.open('workstream-1', storage);

		expect(inspectorDrawer.isOpen('workstream-2', storage)).toBe(false);
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

	it('stays usable when persistence is unavailable', () => {
		const failing = {
			getItem: () => {
				throw new Error('denied');
			},
			setItem: () => {
				throw new Error('denied');
			},
		};

		expect(loadInspectorDrawerOpen('workstream-1', failing)).toBe(false);
		expect(() => saveInspectorDrawerOpen('workstream-1', true, failing)).not.toThrow();
		expect(inspectorDrawer.isOpen('workstream-1', null)).toBe(false);
	});
});

describe('inspector drawer held open for a panel', () => {
	it('opens for the panel without writing it down, and closes once that panel goes', () => {
		const storage = memoryStorage();
		const drawer = new InspectorDrawer(() => false);

		drawer.openForPanel('workstream-1', 'agent-tab', storage);
		expect(drawer.isOpen('workstream-1', storage)).toBe(true);
		expect(drawer.isOpen('workstream-2', storage)).toBe(false);
		expect([...storage.values.keys()]).toEqual([]);

		drawer.closeAfterPanel('workstream-1', 'user-tab');
		expect(drawer.isOpen('workstream-1', storage)).toBe(true);

		drawer.closeAfterPanel('workstream-1', 'agent-tab');
		expect(drawer.isOpen('workstream-1', storage)).toBe(false);
		expect([...storage.values.keys()]).toEqual([]);
	});

	it('stays open after the panel goes once the user opened it', () => {
		const storage = memoryStorage();
		const drawer = new InspectorDrawer(() => false);

		drawer.openForPanel('workstream-1', 'agent-tab', storage);
		drawer.open('workstream-1', storage);
		drawer.closeAfterPanel('workstream-1', 'agent-tab');

		expect(drawer.isOpen('workstream-1', storage)).toBe(true);
		expect(storage.getItem(`${INSPECTOR_DRAWER_STORAGE_KEY_PREFIX}workstream-1`)).toBe('open');
	});

	it('closes for good when the user hides it while it is held open', () => {
		const storage = memoryStorage();
		const drawer = new InspectorDrawer(() => false);

		drawer.openForPanel('workstream-1', 'agent-tab', storage);
		drawer.close('workstream-1', storage);

		expect(drawer.isOpen('workstream-1', storage)).toBe(false);
		expect(drawer.heldOpenBy('workstream-1')).toBe(null);
	});

	it('closes instead of folding when its last panel goes', () => {
		const storage = memoryStorage();
		const drawer = new InspectorDrawer(() => false);

		drawer.openForPanel('workstream-1', 'agent-tab', storage);
		drawer.fold('workstream-1', storage);
		drawer.unfold('workstream-1', storage);

		expect(drawer.isOpen('workstream-1', storage)).toBe(false);
		expect([...storage.values.keys()]).toEqual([]);
	});

	it('leaves an open drawer and the narrow overlay as they are', () => {
		const storage = memoryStorage();
		const drawer = new InspectorDrawer(() => false);
		const overlay = new InspectorDrawer(() => true);

		drawer.open('workstream-1', storage);
		drawer.openForPanel('workstream-1', 'agent-tab', storage);
		overlay.openForPanel('workstream-1', 'agent-tab', storage);

		expect(drawer.heldOpenBy('workstream-1')).toBe(null);
		expect(overlay.isOpen('workstream-1', storage)).toBe(false);
	});
});
