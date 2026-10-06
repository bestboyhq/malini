import { migrateExtensionScopeKeys } from './migrate-extension-scope-keys';
import { WORKSTREAM_TRANSCRIPT_RATIO_KEY } from './panel-storage-keys';

const LEGACY_WORKSTREAM_TRANSCRIPT_RATIO_KEY = 'malini.app.panel:agentic-transcript-ratio-v3';
const SMACK_KEY_PREFIX = 'smack.';

const OBSOLETE_STORAGE_KEY_PREFIXES: readonly string[] = [
	'malini.app.panel:agentic-transcript-ratio-v2:',
];

export const STORAGE_KEY_PREFIX_MIGRATIONS: readonly (readonly [from: string, to: string])[] = [
	['core.desktop.extension-state.', 'malini.extensions.state.'],
	['core.desktop.extensions.', 'malini.extensions.'],
	['core.desktop.agentic.', 'malini.chat.'],
	['core.desktop.', 'malini.app.'],
	['core.extensions.', 'malini.extensions.'],
	['core.agentic.', 'malini.chat.'],
	['core.agent.', 'malini.chat.'],
	['agentic:draft', 'malini.chat.draft'],
	['malini.chat.model-settings:v1:local', 'malini.providers.model-defaults:v1'],
	['malini.chat.model-favorites-v1', 'malini.providers.model-favorites:v1'],
	[LEGACY_WORKSTREAM_TRANSCRIPT_RATIO_KEY, WORKSTREAM_TRANSCRIPT_RATIO_KEY],
];

export function migratedStorageKey(key: string): string | null {
	let current = key;
	for (let hop = 0; hop < STORAGE_KEY_PREFIX_MIGRATIONS.length; hop += 1) {
		const next = renamedOnce(current);
		if (next === null) break;
		current = next;
	}
	return current === key ? null : current;
}

function renamedOnce(key: string): string | null {
	if (key.startsWith(SMACK_KEY_PREFIX)) return key.replaceAll(SMACK_KEY_PREFIX, 'malini.');
	for (const [from, to] of STORAGE_KEY_PREFIX_MIGRATIONS) {
		if (key.startsWith(from)) return `${to}${key.slice(from.length)}`;
	}
	return null;
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
		const migrated = migratedStorageKey(key);
		if (OBSOLETE_STORAGE_KEY_PREFIXES.some((prefix) => (migrated ?? key).startsWith(prefix))) {
			try {
				storage.removeItem(key);
			} catch {}
			continue;
		}
		if (migrated === null) continue;
		try {
			const value = storage.getItem(key);
			if (value !== null && storage.getItem(migrated) === null) storage.setItem(migrated, value);
			storage.removeItem(key);
		} catch {}
	}
	migrateExtensionScopeKeys(storage);
}
