import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_PREFERENCES } from '$shared/providers/providers.api';
import {
	chatModelSnapshotKey,
	MODEL_MEMORY_KEY,
	readChatModelSnapshot,
	readModelMemory,
	readStoredRunProfile,
	writeChatModelSnapshot,
	writeModelMemory,
	writeStoredRunProfile,
} from './model-preferences.storage';

function memoryStorage(seed: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> & {
	values: Map<string, string>;
} {
	const values = new Map(Object.entries(seed));
	return {
		values,
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, value),
	};
}

describe('model memory', () => {
	it('falls back to the defaults until a model is remembered', () => {
		const storage = memoryStorage();
		const defaults = {
			planning: { model: 'haiku' },
			implementation: { model: 'sonnet' },
		} as const;
		expect(readModelMemory(defaults, storage)).toEqual(defaults);

		const remembered = {
			planning: { model: 'opus' },
			implementation: { model: 'sonnet[1m]' },
		} as const;
		writeModelMemory(remembered, defaults, storage);

		expect(readModelMemory(DEFAULT_MODEL_PREFERENCES, storage)).toEqual(remembered);
	});

	it('repairs a corrupt memory from the current defaults', () => {
		const storage = memoryStorage({ [MODEL_MEMORY_KEY]: '{broken' });
		expect(readModelMemory(DEFAULT_MODEL_PREFERENCES, storage)).toEqual(DEFAULT_MODEL_PREFERENCES);
	});

	it('persists an immutable role/model snapshot per chat', () => {
		const storage = memoryStorage();
		writeChatModelSnapshot(
			'session-a',
			{ role: 'planning', selection: { model: 'opus' } },
			storage,
		);

		expect(JSON.parse(storage.values.get(chatModelSnapshotKey('session-a')) ?? '')).toEqual({
			role: 'planning',
			selection: { model: 'opus' },
		});
		expect(readChatModelSnapshot('session-a', storage)).toEqual({
			role: 'planning',
			selection: { model: 'opus' },
		});
	});
});

describe('run profile memory', () => {
	it('opens a workstream without a profile of its own at the effort last used anywhere', () => {
		const storage = memoryStorage();
		expect(readStoredRunProfile('ws-new', storage).effort).toBe('medium');

		writeStoredRunProfile('ws-a', { effort: 'xhigh', mode: 'plan', access: 'full' }, storage);

		expect(readStoredRunProfile('ws-new', storage)).toMatchObject({
			effort: 'xhigh',
			mode: 'agent',
		});
		expect(readStoredRunProfile('ws-a', storage)).toEqual({
			effort: 'xhigh',
			mode: 'plan',
			access: 'full',
		});
	});
});
