import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_PREFERENCES } from '$shared/providers/providers.api';
import {
	chatModelSnapshotKey,
	readChatModelSnapshot,
	readWorkstreamModelMemory,
	workstreamModelMemoryKey,
	writeChatModelSnapshot,
	writeWorkstreamModelMemory,
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

describe('workstream model memory', () => {
	it('keeps the model defaults separate from workstream snapshots', () => {
		const storage = memoryStorage();
		const defaults = {
			planning: { model: 'opus' },
			implementation: { model: 'sonnet[1m]' },
		} as const;
		writeWorkstreamModelMemory('stream-a', defaults, defaults, storage);

		const laterDefaults = {
			planning: { model: 'haiku' },
			implementation: { model: 'sonnet' },
		} as const;

		expect(readWorkstreamModelMemory('stream-a', DEFAULT_MODEL_PREFERENCES, storage)).toEqual(
			defaults,
		);
		expect(readWorkstreamModelMemory('stream-b', laterDefaults, storage)).toEqual(laterDefaults);
	});

	it('repairs a corrupt workstream memory from the current defaults', () => {
		const storage = memoryStorage({
			[workstreamModelMemoryKey('stream-a')]: '{broken',
		});
		expect(readWorkstreamModelMemory('stream-a', DEFAULT_MODEL_PREFERENCES, storage)).toEqual(
			DEFAULT_MODEL_PREFERENCES,
		);
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
