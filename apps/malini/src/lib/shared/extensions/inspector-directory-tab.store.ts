import type { InspectorPreferenceStorage } from './inspector-preference-storage';

export const INSPECTOR_DIRECTORY_TAB_STORAGE_KEY_PREFIX =
	'malini.extensions.inspector-directory-tab-v1:';

function browserStorage(): InspectorPreferenceStorage | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

function storageKey(workstreamId: string): string {
	return `${INSPECTOR_DIRECTORY_TAB_STORAGE_KEY_PREFIX}${workstreamId}`;
}

export function loadInspectorDirectoryTabOpen(
	workstreamId: string,
	storage: InspectorPreferenceStorage | null = browserStorage(),
): boolean {
	if (!workstreamId || !storage) return false;

	try {
		return storage.getItem(storageKey(workstreamId)) === 'open';
	} catch {
		return false;
	}
}

export function saveInspectorDirectoryTabOpen(
	workstreamId: string,
	open: boolean,
	storage: InspectorPreferenceStorage | null = browserStorage(),
): void {
	if (!workstreamId || !storage) return;

	try {
		storage.setItem(storageKey(workstreamId), open ? 'open' : 'closed');
	} catch {}
}
