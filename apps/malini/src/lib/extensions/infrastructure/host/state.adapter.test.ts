import { describe, expect, it } from 'vitest';

import type { ExtensionStateStorage } from '../../domain/extension-storage';
import { createDesktopExtensionState, extensionStateStorageKey } from './state.adapter';

type VerificationChecks = { checks: { id: string; passed: boolean }[] };

function assertChecks(value: unknown): asserts value is VerificationChecks {
	if (
		typeof value !== 'object' ||
		value === null ||
		!('checks' in value) ||
		!Array.isArray(value.checks)
	) {
		throw new Error('Expected a verification checks record');
	}
}

function memoryStorage(seed: Record<string, string> = {}): ExtensionStateStorage & {
	values: Map<string, string>;
} {
	const values = new Map(Object.entries(seed));
	return {
		values,
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, value),
		removeItem: (key) => void values.delete(key),
	};
}

describe('desktop extension state', () => {
	it('isolates extensions and global, repository, and workstream scopes', async () => {
		const storage = memoryStorage();
		const first = createDesktopExtensionState({ extensionId: 'example.preview', storage });
		const second = createDesktopExtensionState({ extensionId: 'malini.repository', storage });
		await first.set('status', { state: 'ready' });
		await first.set('status', 'repository', { kind: 'repository', id: 'repo-1' });
		await first.set('status', 'workstream', { kind: 'workstream', id: 'workstream-1' });

		expect(await first.get('status')).toEqual({ state: 'ready' });
		expect(await first.get('status', { kind: 'repository', id: 'repo-1' })).toBe('repository');
		expect(await first.get('status', { kind: 'workstream', id: 'workstream-1' })).toBe(
			'workstream',
		);
		expect(await second.get('status')).toBeNull();
		expect(storage.values.size).toBe(3);
	});

	it('persists JSON values across host recreation without sharing mutable references', async () => {
		const storage = memoryStorage();
		const first = createDesktopExtensionState({ extensionId: 'example.verification', storage });
		const value = { checks: [{ id: 'test', passed: true }] };
		await first.set('latest', value);
		value.checks[0]!.passed = false;

		const second = createDesktopExtensionState({ extensionId: 'example.verification', storage });
		const restored = await second.get('latest');
		expect(restored).toEqual({ checks: [{ id: 'test', passed: true }] });
		assertChecks(restored);
		restored.checks[0]!.passed = false;
		expect(await first.get('latest')).toEqual({ checks: [{ id: 'test', passed: true }] });
	});

	it('deletes one scope without affecting another', async () => {
		const storage = memoryStorage();
		const state = createDesktopExtensionState({ extensionId: 'example.preview', storage });
		await state.set('url', 'global');
		await state.set('url', 'workstream', { kind: 'workstream', id: 'workstream-1' });
		await state.delete('url', { kind: 'workstream', id: 'workstream-1' });
		expect(await state.get('url')).toBe('global');
		expect(await state.get('url', { kind: 'workstream', id: 'workstream-1' })).toBeNull();
	});

	it('fails closed on malformed persisted JSON until an explicit reset', async () => {
		const key = extensionStateStorageKey('example.preview');
		const storage = memoryStorage({ [key]: '{ definitely not JSON' });
		const state = createDesktopExtensionState({ extensionId: 'example.preview', storage });
		await expect(state.get('status')).rejects.toThrow('unreadable');
		expect(storage.getItem(key)).toBe('{ definitely not JSON');
		await state.delete('status');
		expect(storage.getItem(key)).toBe('{ definitely not JSON');
		expect(await state.get('status')).toBeNull();
		await expect(state.get('other-status')).rejects.toThrow('unreadable');
		await state.set('status', 'ready');
		expect(await state.get('status')).toBe('ready');
	});

	it('leaves a durable fail-closed marker when persistence fails', async () => {
		const key = extensionStateStorageKey('malini.repository');
		const storage = memoryStorage();
		const setItem = storage.setItem;
		let rejectRecordWrite = true;
		storage.setItem = (candidate, value) => {
			if (candidate.includes(':entry:') && !candidate.endsWith(':pending') && rejectRecordWrite) {
				rejectRecordWrite = false;
				throw new Error('quota exceeded');
			}
			setItem(candidate, value);
		};

		const first = createDesktopExtensionState({ extensionId: 'malini.repository', storage });
		await expect(
			first.set('workstream-todos.v1', { version: 1, todos: [{ id: 'open' }] }),
		).rejects.toThrow('could not be persisted');
		await expect(first.get('workstream-todos.v1')).rejects.toThrow('reset this entry');
		const pendingKey = [...storage.values.keys()].find((candidate) =>
			candidate.endsWith(':pending'),
		);
		expect(pendingKey).toBeDefined();
		expect(storage.getItem(pendingKey!)).toBe('pending');

		const recreated = createDesktopExtensionState({ extensionId: 'malini.repository', storage });
		await expect(recreated.get('workstream-todos.v1')).rejects.toThrow('could not be persisted');
		await recreated.delete('workstream-todos.v1');
		expect(storage.getItem(key)).toBeNull();
		expect(storage.getItem(pendingKey!)).toBeNull();
		expect(await recreated.get('workstream-todos.v1')).toBeNull();
	});

	it('poisons only the failed entry when the first marker write is rejected', async () => {
		const storage = memoryStorage();
		const setItem = storage.setItem;
		let rejectedMarkers = 0;
		storage.setItem = (candidate, value) => {
			if (candidate.endsWith(':pending') && rejectedMarkers < 2) {
				rejectedMarkers += 1;
				throw new Error('marker write denied');
			}
			setItem(candidate, value);
		};

		const first = createDesktopExtensionState({ extensionId: 'malini.repository', storage });
		await expect(first.set('workstream-todos.v1', { version: 1, todos: [] })).rejects.toThrow(
			'could not start a durable write',
		);
		const recreated = createDesktopExtensionState({ extensionId: 'malini.repository', storage });
		await expect(recreated.get('workstream-todos.v1')).rejects.toThrow(
			'could not start a durable write',
		);
		await recreated.delete('workstream-todos.v1');
		expect(await recreated.get('workstream-todos.v1')).toBeNull();
	});

	it('keeps an entry fail-closed across same-process hosts when every safety write fails', async () => {
		const storage = memoryStorage();
		const initial = createDesktopExtensionState({ extensionId: 'malini.repository', storage });
		await initial.set('workstream-todos.v1', {
			version: 1,
			todos: [{ id: 'old', text: 'persisted' }],
		});
		const setItem = storage.setItem;
		storage.setItem = (candidate, value) => {
			if (candidate.includes(':entry:')) throw new Error('all entry writes denied');
			setItem(candidate, value);
		};
		await expect(
			initial.set('workstream-todos.v1', {
				version: 1,
				todos: [{ id: 'new', text: 'must not disappear' }],
			}),
		).rejects.toThrow('could not start a durable write');

		storage.setItem = setItem;
		const recreated = createDesktopExtensionState({ extensionId: 'malini.repository', storage });
		await expect(recreated.get('workstream-todos.v1')).rejects.toThrow(
			'could not start a durable write',
		);
		await recreated.delete('workstream-todos.v1');
		expect(await recreated.get('workstream-todos.v1')).toBeNull();
	});

	it('never lets a stale host reset another entry or overwrite a repaired snapshot silently', async () => {
		const storage = memoryStorage();
		const stale = createDesktopExtensionState({ extensionId: 'malini.repository', storage });
		await stale.set('pull-request-binding.v1', { number: 7 });
		const setItem = storage.setItem;
		let rejectRecordWrite = true;
		storage.setItem = (candidate, value) => {
			if (candidate.includes(':entry:') && !candidate.endsWith(':pending') && rejectRecordWrite) {
				rejectRecordWrite = false;
				throw new Error('write interrupted');
			}
			setItem(candidate, value);
		};
		await expect(stale.set('workstream-todos.v1', { version: 1, todos: [] })).rejects.toThrow(
			'could not be persisted',
		);

		const repaired = createDesktopExtensionState({ extensionId: 'malini.repository', storage });
		await repaired.delete('workstream-todos.v1');
		await repaired.set('workstream-todos.v1', {
			version: 1,
			todos: [{ id: 'new', text: 'fresh' }],
		});
		await expect(stale.delete('workstream-todos.v1')).rejects.toThrow('changed after this error');
		expect(await repaired.get('workstream-todos.v1')).toEqual({
			version: 1,
			todos: [{ id: 'new', text: 'fresh' }],
		});
		expect(await repaired.get('pull-request-binding.v1')).toEqual({ number: 7 });
	});

	it('fails closed when the shipping storage is unavailable', async () => {
		const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
		const recoveredStorage = memoryStorage();
		Object.defineProperty(globalThis, 'localStorage', {
			configurable: true,
			get: () => {
				throw new Error('storage denied');
			},
		});
		try {
			const state = createDesktopExtensionState({ extensionId: 'malini.repository' });
			await expect(state.get('workstream-todos.v1')).rejects.toThrow('unavailable');
			await expect(state.set('workstream-todos.v1', { version: 1, todos: [] })).rejects.toThrow(
				'could not be acquired',
			);
			Object.defineProperty(globalThis, 'localStorage', {
				configurable: true,
				value: recoveredStorage,
			});
			const recreated = createDesktopExtensionState({ extensionId: 'malini.repository' });
			await expect(recreated.get('workstream-todos.v1')).rejects.toThrow('could not be acquired');
			await recreated.delete('workstream-todos.v1');
			expect(await recreated.get('workstream-todos.v1')).toBeNull();
		} finally {
			if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
			else Reflect.deleteProperty(globalThis, 'localStorage');
		}
	});

	it('preserves a valid recovered entry when storage acquisition previously failed', async () => {
		const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
		const legacyKey = extensionStateStorageKey('example.recovered-repository');
		const recoveredStorage = memoryStorage({
			[legacyKey]: JSON.stringify({
				version: 1,
				entries: [
					{
						key: 'workstream-todos.v1',
						scope: { kind: 'workstream', id: 'workstream-a' },
						value: { version: 1, todos: [{ id: 'persisted-open' }] },
					},
				],
			}),
		});
		Object.defineProperty(globalThis, 'localStorage', {
			configurable: true,
			get: () => {
				throw new Error('storage denied');
			},
		});
		try {
			const failed = createDesktopExtensionState({ extensionId: 'example.recovered-repository' });
			await expect(
				failed.set(
					'workstream-todos.v1',
					{ version: 1, todos: [{ id: 'attempted' }] },
					{ kind: 'workstream', id: 'workstream-a' },
				),
			).rejects.toThrow('could not be acquired');
			Object.defineProperty(globalThis, 'localStorage', {
				configurable: true,
				value: recoveredStorage,
			});
			const recreated = createDesktopExtensionState({
				extensionId: 'example.recovered-repository',
			});
			await expect(
				recreated.get('workstream-todos.v1', { kind: 'workstream', id: 'workstream-a' }),
			).rejects.toThrow('could not be acquired');
			await recreated.delete('workstream-todos.v1', {
				kind: 'workstream',
				id: 'workstream-a',
			});
			expect(
				await recreated.get('workstream-todos.v1', {
					kind: 'workstream',
					id: 'workstream-a',
				}),
			).toEqual({ version: 1, todos: [{ id: 'persisted-open' }] });
		} finally {
			if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
			else Reflect.deleteProperty(globalThis, 'localStorage');
		}
	});

	it('rejects values that JSON cannot represent', async () => {
		const state = createDesktopExtensionState({
			extensionId: 'example.preview',
			storage: memoryStorage(),
		});
		const cyclic: { self?: unknown } = {};
		cyclic.self = cyclic;
		await expect(state.set('cyclic', cyclic)).rejects.toThrow('JSON serializable');
	});
});
