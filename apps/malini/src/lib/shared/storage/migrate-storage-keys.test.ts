import { describe, expect, it } from 'vitest';
import { migrateStorageKeys, migratedStorageKey } from './migrate-storage-keys';

function memoryStorage(seed: Record<string, string> = {}): Storage {
	const entries = new Map<string, string>(Object.entries(seed));
	return {
		get length() {
			return entries.size;
		},
		key: (index: number) => [...entries.keys()][index] ?? null,
		getItem: (key: string) => entries.get(key) ?? null,
		setItem: (key: string, value: string) => {
			entries.set(key, value);
		},
		removeItem: (key: string) => {
			entries.delete(key);
		},
		clear: () => entries.clear(),
	};
}

describe('migratedStorageKey', () => {
	it('moves the model settings onto the providers model defaults', () => {
		expect(migratedStorageKey('malini.chat.model-settings:v1:local')).toBe(
			'malini.providers.model-defaults:v1',
		);
	});

	it('leaves every other key alone', () => {
		expect(migratedStorageKey('malini.providers.model-defaults:v1')).toBeNull();
		expect(migratedStorageKey('malini.chat.draft:ws-1')).toBeNull();
	});
});

describe('migrateStorageKeys', () => {
	it('copies a renamed key onto its new name and removes the source', () => {
		const storage = memoryStorage({
			'malini.chat.model-settings:v1:local': '{"model":"opus"}',
			unrelated: 'keep me',
		});

		migrateStorageKeys(storage);

		expect(storage.getItem('malini.providers.model-defaults:v1')).toBe('{"model":"opus"}');
		expect(storage.getItem('malini.chat.model-settings:v1:local')).toBeNull();
		expect(storage.getItem('unrelated')).toBe('keep me');
	});

	it('keeps an existing target value and is idempotent', () => {
		const storage = memoryStorage({
			'malini.chat.model-settings:v1:local': 'stale',
			'malini.providers.model-defaults:v1': 'current',
		});

		migrateStorageKeys(storage);
		migrateStorageKeys(storage);

		expect(storage.getItem('malini.providers.model-defaults:v1')).toBe('current');
		expect(storage.length).toBe(1);
	});

	it('drops issue drafts nothing reads any more', () => {
		const storage = memoryStorage({
			'malini.chat.draft-issues:ws-1|new': '[]',
			'malini.app.panel:shell-sidebar': '280',
		});

		migrateStorageKeys(storage);

		expect(storage.length).toBe(1);
		expect(storage.getItem('malini.app.panel:shell-sidebar')).toBe('280');
	});
});
