import { afterAll, describe, expect, it, vi } from 'vitest';

import { sidebarCollapsedStore } from './sidebar-collapsed.store.svelte';

const stored = new Map<string, string>();

vi.stubGlobal('localStorage', {
	getItem: (key: string): string | null => stored.get(key) ?? null,
	setItem: (key: string, value: string): void => {
		stored.set(key, value);
	},
	removeItem: (key: string): void => {
		stored.delete(key);
	},
});

afterAll(() => {
	vi.unstubAllGlobals();
});

describe('sidebarCollapsedStore', () => {
	it('hydrates from storage once and ignores later re-reads', () => {
		stored.set(sidebarCollapsedStore.storageKey, '1');
		expect(sidebarCollapsedStore.current).toBe(false);

		sidebarCollapsedStore.hydrate();
		expect(sidebarCollapsedStore.current).toBe(true);

		stored.set(sidebarCollapsedStore.storageKey, '0');
		sidebarCollapsedStore.hydrate();
		expect(sidebarCollapsedStore.current).toBe(true);
	});

	it('toggle flips the state and persists it', () => {
		sidebarCollapsedStore.toggle();
		expect(sidebarCollapsedStore.current).toBe(false);
		expect(stored.get(sidebarCollapsedStore.storageKey)).toBe('0');

		sidebarCollapsedStore.toggle();
		expect(sidebarCollapsedStore.current).toBe(true);
		expect(stored.get(sidebarCollapsedStore.storageKey)).toBe('1');
	});

	it('persists under the same panel namespace as the sidebar width', () => {
		expect(sidebarCollapsedStore.storageKey).toBe('malini.app.panel:shell-sidebar-collapsed');
	});
});
