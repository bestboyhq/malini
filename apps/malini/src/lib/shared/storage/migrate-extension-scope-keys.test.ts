import { describe, expect, it } from 'vitest';

import { extensionSettingStorageKey } from '$lib/extensions/infrastructure/host/contributions.adapter';
import {
	createDesktopExtensionState,
	extensionStateStorageKey,
} from '$lib/extensions/infrastructure/host/state.adapter';
import { migrateExtensionScopeKeys } from './migrate-extension-scope-keys';
import { migrateStorageKeys } from './migrate-storage-keys';

function memoryStorage(seed: Record<string, string> = {}): Storage & {
	entries: Map<string, string>;
} {
	const entries = new Map<string, string>(Object.entries(seed));
	return {
		entries,
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

function legacyRecordKey(extensionId: string, workstreamId: string, key: string): string {
	const identity = JSON.stringify(['workspace', workstreamId, key]);
	return `${extensionStateStorageKey(extensionId)}:entry:${encodeURIComponent(identity)}`;
}

function legacyRecord(workstreamId: string, key: string, value: unknown): string {
	const identity = JSON.stringify(['workspace', workstreamId, key]);
	return JSON.stringify({ version: 1, identity, deleted: false, value });
}

describe('migrateExtensionScopeKeys', () => {
	it('keeps workstream-scoped extension state readable after the scope rename', async () => {
		const todos = { version: 1, todos: [{ id: 'todo-1', text: 'Ship it' }] };
		const storage = memoryStorage({
			[legacyRecordKey('malini.repository', 'ws-1', 'todos')]: legacyRecord('ws-1', 'todos', todos),
		});

		migrateExtensionScopeKeys(storage);

		const state = createDesktopExtensionState({ extensionId: 'malini.repository', storage });
		await expect(state.get('todos', { kind: 'workstream', id: 'ws-1' })).resolves.toEqual(todos);
		expect(storage.getItem(legacyRecordKey('malini.repository', 'ws-1', 'todos'))).toBeNull();
	});

	it('moves an interrupted write marker with its record', () => {
		const pendingKey = `${legacyRecordKey('malini.repository', 'ws-1', 'todos')}:pending`;
		const storage = memoryStorage({ [pendingKey]: 'pending' });

		migrateExtensionScopeKeys(storage);

		const identity = JSON.stringify(['workstream', 'ws-1', 'todos']);
		const migratedKey = `${extensionStateStorageKey('malini.repository')}:entry:${encodeURIComponent(identity)}:pending`;
		expect(storage.getItem(migratedKey)).toBe('pending');
		expect(storage.getItem(pendingKey)).toBeNull();
	});

	it('rewrites workstream-scoped entries inside a legacy state envelope', async () => {
		const storage = memoryStorage({
			[extensionStateStorageKey('malini.repository')]: JSON.stringify({
				version: 1,
				entries: [
					{ key: 'binding', scope: { kind: 'workspace', id: 'ws-2' }, value: { number: 7 } },
					{ key: 'mode', scope: { kind: 'global' }, value: 'compact' },
				],
			}),
		});

		migrateExtensionScopeKeys(storage);

		const state = createDesktopExtensionState({ extensionId: 'malini.repository', storage });
		await expect(state.get('binding', { kind: 'workstream', id: 'ws-2' })).resolves.toEqual({
			number: 7,
		});
		await expect(state.get('mode')).resolves.toBe('compact');
	});

	it('renames the scope segment of workstream-scoped setting keys', () => {
		const storage = memoryStorage({
			'malini.extensions.settings.v1/acme.extension/workspace.ws-1/acme.extension.mode': 'true',
			'malini.extensions.settings.v1/acme.extension/global/acme.extension.mode': 'false',
		});

		migrateExtensionScopeKeys(storage);

		expect(
			storage.getItem(
				extensionSettingStorageKey('acme.extension', 'acme.extension.mode', {
					kind: 'workstream',
					id: 'ws-1',
				}),
			),
		).toBe('true');
		expect(
			storage.getItem(
				'malini.extensions.settings.v1/acme.extension/workspace.ws-1/acme.extension.mode',
			),
		).toBeNull();
		expect(
			storage.getItem('malini.extensions.settings.v1/acme.extension/global/acme.extension.mode'),
		).toBe('false');
	});

	it('keeps a newer workstream value, leaves unrelated keys alone, and is idempotent', () => {
		const migratedKey = `${extensionStateStorageKey('malini.repository')}:entry:${encodeURIComponent(
			JSON.stringify(['workstream', 'ws-1', 'todos']),
		)}`;
		const current = JSON.stringify({
			version: 1,
			identity: JSON.stringify(['workstream', 'ws-1', 'todos']),
			deleted: false,
			value: 'current',
		});
		const storage = memoryStorage({
			[legacyRecordKey('malini.repository', 'ws-1', 'todos')]: legacyRecord(
				'ws-1',
				'todos',
				'stale',
			),
			[migratedKey]: current,
			unrelated: 'keep me',
		});

		migrateExtensionScopeKeys(storage);
		migrateExtensionScopeKeys(storage);

		expect(storage.getItem(migratedKey)).toBe(current);
		expect(storage.getItem('unrelated')).toBe('keep me');
		expect(storage.entries.size).toBe(2);
	});

	it('runs as part of the boot storage migration after legacy prefixes move', async () => {
		const legacyPrefixKey = legacyRecordKey('malini.repository', 'ws-1', 'todos').replace(
			'malini.extensions.state.',
			'core.desktop.extension-state.',
		);
		const storage = memoryStorage({
			[legacyPrefixKey]: legacyRecord('ws-1', 'todos', 'from the old key'),
		});

		migrateStorageKeys(storage);

		const state = createDesktopExtensionState({ extensionId: 'malini.repository', storage });
		await expect(state.get('todos', { kind: 'workstream', id: 'ws-1' })).resolves.toBe(
			'from the old key',
		);
	});
});
