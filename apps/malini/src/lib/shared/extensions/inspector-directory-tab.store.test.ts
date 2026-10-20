import { describe, expect, it } from 'vitest';

import {
	INSPECTOR_DIRECTORY_TAB_STORAGE_KEY_PREFIX,
	loadInspectorDirectoryTabOpen,
	saveInspectorDirectoryTabOpen,
} from './inspector-directory-tab.store';

function memoryStorage(seed: Record<string, string> = {}) {
	const values = new Map(Object.entries(seed));
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
	};
}

describe('extension directory inspector tab preferences', () => {
	it('keeps open state isolated per workstream until that tab is explicitly closed', () => {
		const storage = memoryStorage();

		saveInspectorDirectoryTabOpen('workstream-alpha', true, storage);
		expect(loadInspectorDirectoryTabOpen('workstream-alpha', storage)).toBe(true);
		expect(loadInspectorDirectoryTabOpen('workstream-beta', storage)).toBe(false);

		saveInspectorDirectoryTabOpen('workstream-alpha', false, storage);
		expect(loadInspectorDirectoryTabOpen('workstream-alpha', storage)).toBe(false);
		expect(storage.getItem(`${INSPECTOR_DIRECTORY_TAB_STORAGE_KEY_PREFIX}workstream-alpha`)).toBe(
			'closed',
		);
	});

	it('falls back to a closed tab when storage is corrupt or unavailable', () => {
		const storage = memoryStorage({
			[`${INSPECTOR_DIRECTORY_TAB_STORAGE_KEY_PREFIX}workstream-invalid`]: 'maybe',
		});

		expect(loadInspectorDirectoryTabOpen('workstream-invalid', storage)).toBe(false);
		expect(loadInspectorDirectoryTabOpen('', storage)).toBe(false);
		expect(loadInspectorDirectoryTabOpen('workstream-null', null)).toBe(false);
	});
});
