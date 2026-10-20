import { migrateExtensionScopeKeys } from './migrate-extension-scope-keys';

const OBSOLETE_STORAGE_KEY_PREFIX = 'malini.chat.draft-issues:';
const LEGACY_MODEL_DEFAULTS_KEY_PREFIX = 'malini.chat.model-settings:v1:local';
const MODEL_DEFAULTS_KEY_PREFIX = 'malini.providers.model-defaults:v1';

export function migratedStorageKey(key: string): string | null {
	if (!key.startsWith(LEGACY_MODEL_DEFAULTS_KEY_PREFIX)) return null;
	return `${MODEL_DEFAULTS_KEY_PREFIX}${key.slice(LEGACY_MODEL_DEFAULTS_KEY_PREFIX.length)}`;
}

export function migrateStorageKeys(storage: Storage | undefined = globalThis.localStorage): void {
	if (!storage) return;
	let keys: string[];
	try {
		keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
			(key): key is string => key !== null,
		);
	} catch {
		return;
	}
	for (const key of keys) {
		if (key.startsWith(OBSOLETE_STORAGE_KEY_PREFIX)) {
			try {
				storage.removeItem(key);
			} catch {}
			continue;
		}
		const migrated = migratedStorageKey(key);
		if (migrated === null) continue;
		try {
			const value = storage.getItem(key);
			if (value !== null && storage.getItem(migrated) === null) storage.setItem(migrated, value);
			storage.removeItem(key);
		} catch {}
	}
	migrateExtensionScopeKeys(storage);
}
