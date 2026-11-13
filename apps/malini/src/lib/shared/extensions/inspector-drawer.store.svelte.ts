import { isNarrowLayout } from '$shared/shell/narrow-layout.svelte';
import type { InspectorPreferenceStorage } from './inspector-preference-storage';

export const INSPECTOR_DRAWER_STORAGE_KEY_PREFIX = 'malini.extensions.inspector-drawer-v1:';

type InspectorDrawerState = 'open' | 'closed' | 'folded';

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

function loadInspectorDrawerState(
	workstreamId: string,
	storage: InspectorPreferenceStorage | null,
): string | null {
	if (!workstreamId || !storage) return null;

	try {
		return storage.getItem(storageKey(workstreamId));
	} catch {
		return null;
	}
}

function saveInspectorDrawerState(
	workstreamId: string,
	state: InspectorDrawerState,
	storage: InspectorPreferenceStorage | null,
): void {
	if (!workstreamId || !storage) return;

	try {
		storage.setItem(storageKey(workstreamId), state);
	} catch {}
}

export function loadInspectorDrawerOpen(
	workstreamId: string,
	storage: InspectorPreferenceStorage | null = browserStorage(),
): boolean {
	return loadInspectorDrawerState(workstreamId, storage) === 'open';
}

export function saveInspectorDrawerOpen(
	workstreamId: string,
	open: boolean,
	storage: InspectorPreferenceStorage | null = browserStorage(),
): void {
	saveInspectorDrawerState(workstreamId, open ? 'open' : 'closed', storage);
}

export class InspectorDrawer {
	#revision = $state(0);
	#overlay: { workstreamId: string; folded: boolean } | null = $state.raw(null);
	#heldOpen: ReadonlyMap<string, string> = $state.raw(new Map());
	readonly #narrow: () => boolean;

	constructor(narrow: () => boolean = isNarrowLayout) {
		this.#narrow = narrow;
	}

	get overlay(): boolean {
		return this.#narrow();
	}

	isOpen(
		workstreamId: string,
		storage: InspectorPreferenceStorage | null = browserStorage(),
	): boolean {
		if (this.overlay) return this.#overlay?.workstreamId === workstreamId && !this.#overlay.folded;
		this.#revision;
		return this.#heldOpen.has(workstreamId) || loadInspectorDrawerOpen(workstreamId, storage);
	}

	heldOpenBy(workstreamId: string): string | null {
		return this.#heldOpen.get(workstreamId) ?? null;
	}

	openForPanel(
		workstreamId: string,
		panelId: string,
		storage?: InspectorPreferenceStorage | null,
	): void {
		const resolved = storage === undefined ? browserStorage() : storage;
		if (!workstreamId || this.overlay || this.isOpen(workstreamId, resolved)) return;
		this.#heldOpen = new Map(this.#heldOpen).set(workstreamId, panelId);
	}

	closeAfterPanel(workstreamId: string, panelId: string): void {
		if (this.heldOpenBy(workstreamId) === panelId) this.#release(workstreamId);
	}

	#release(workstreamId: string): boolean {
		if (!this.#heldOpen.has(workstreamId)) return false;
		const held = new Map(this.#heldOpen);
		held.delete(workstreamId);
		this.#heldOpen = held;
		return true;
	}

	setOpen(
		workstreamId: string,
		open: boolean,
		storage: InspectorPreferenceStorage | null = browserStorage(),
	): void {
		if (!workstreamId) return;
		if (this.overlay) {
			this.#overlay = open ? { workstreamId, folded: false } : null;
			return;
		}
		this.#release(workstreamId);
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

	fold(workstreamId: string, storage?: InspectorPreferenceStorage | null): void {
		const resolved = storage === undefined ? browserStorage() : storage;
		if (!this.isOpen(workstreamId, resolved)) return;
		if (this.overlay) {
			this.#overlay = { workstreamId, folded: true };
			return;
		}
		if (this.#release(workstreamId)) return;
		saveInspectorDrawerState(workstreamId, 'folded', resolved);
		this.#revision += 1;
	}

	unfold(workstreamId: string, storage?: InspectorPreferenceStorage | null): void {
		const resolved = storage === undefined ? browserStorage() : storage;
		const folded = this.overlay
			? this.#overlay?.workstreamId === workstreamId && this.#overlay.folded
			: loadInspectorDrawerState(workstreamId, resolved) === 'folded';
		if (folded) this.setOpen(workstreamId, true, resolved);
	}
}

export const inspectorDrawer = new InspectorDrawer();
