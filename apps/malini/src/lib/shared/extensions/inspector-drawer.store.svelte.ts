import { isNarrowLayout } from '$shared/shell/narrow-layout.svelte';
import type { InspectorPreferenceStorage } from './inspector-preference-storage';

export const INSPECTOR_DRAWER_STORAGE_KEY_PREFIX = 'malini.extensions.inspector-drawer-v1:';

function browserStorage(): InspectorPreferenceStorage | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

function storageKey(workstreamId: string): string {
	return `${INSPECTOR_DRAWER_STORAGE_KEY_PREFIX}${workstreamId}`;
}

export function loadInspectorDrawerOpen(
	workstreamId: string,
	storage: InspectorPreferenceStorage | null = browserStorage(),
): boolean {
	if (!workstreamId || !storage) return true;

	try {
		return storage.getItem(storageKey(workstreamId)) !== 'closed';
	} catch {
		return true;
	}
}

export function saveInspectorDrawerOpen(
	workstreamId: string,
	open: boolean,
	storage: InspectorPreferenceStorage | null = browserStorage(),
): void {
	if (!workstreamId || !storage) return;

	try {
		storage.setItem(storageKey(workstreamId), open ? 'open' : 'closed');
	} catch {}
}

class InspectorDrawer {
	#revision = $state(0);
	#overlayWorkstreamId: string | null = $state(null);

	get overlay(): boolean {
		return isNarrowLayout();
	}

	isOpen(
		workstreamId: string,
		storage: InspectorPreferenceStorage | null = browserStorage(),
	): boolean {
		if (this.overlay) return this.#overlayWorkstreamId === workstreamId;
		this.#revision;
		return loadInspectorDrawerOpen(workstreamId, storage);
	}

	setOpen(
		workstreamId: string,
		open: boolean,
		storage: InspectorPreferenceStorage | null = browserStorage(),
	): void {
		if (!workstreamId) return;
		if (this.overlay) {
			this.#overlayWorkstreamId = open ? workstreamId : null;
			return;
		}
		if (loadInspectorDrawerOpen(workstreamId, storage) === open) return;
		saveInspectorDrawerOpen(workstreamId, open, storage);
		this.#revision += 1;
	}

	open(workstreamId: string, storage?: InspectorPreferenceStorage | null): void {
		this.setOpen(workstreamId, true, storage === undefined ? browserStorage() : storage);
	}

	close(workstreamId: string, storage?: InspectorPreferenceStorage | null): void {
		this.setOpen(workstreamId, false, storage === undefined ? browserStorage() : storage);
	}

	toggle(workstreamId: string, storage?: InspectorPreferenceStorage | null): void {
		const resolved = storage === undefined ? browserStorage() : storage;
		this.setOpen(workstreamId, !this.isOpen(workstreamId, resolved), resolved);
	}
}

export const inspectorDrawer = new InspectorDrawer();
