import { describe, expect, it } from 'vitest';
import { toggleModelPreset } from '$shared/providers/domain/model-preferences';
import { modelPresetsStorage } from './model-presets.storage';

function memoryStorage(seed: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> {
	const values = new Map(Object.entries(seed));
	return {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => {
			values.set(key, value);
		},
	};
}

const opusMax = { selection: { provider: 'claude', model: 'opus' }, effort: 'max' } as const;
const sonnetLow = { selection: { provider: 'claude', model: 'sonnet' }, effort: 'low' } as const;

describe('model presets storage', () => {
	it('saves a preset once and removes it on the second toggle', () => {
		const storage = memoryStorage();
		modelPresetsStorage.write(toggleModelPreset([opusMax], sonnetLow), storage);
		expect(modelPresetsStorage.read(storage)).toEqual([opusMax, sonnetLow]);

		modelPresetsStorage.write(
			toggleModelPreset(modelPresetsStorage.read(storage), opusMax),
			storage,
		);
		expect(modelPresetsStorage.read(storage)).toEqual([sonnetLow]);
	});

	it('keeps a model without an effort and drops broken and repeated entries', () => {
		const haiku = { selection: { provider: 'claude', model: 'haiku' }, effort: null };
		const storage = memoryStorage({
			[modelPresetsStorage.key]: JSON.stringify([
				opusMax,
				haiku,
				opusMax,
				{ selection: opusMax.selection, effort: 'turbo' },
				{ selection: { provider: 'claude', model: '' }, effort: 'low' },
				'opus',
			]),
		});
		expect(modelPresetsStorage.read(storage)).toEqual([opusMax, haiku]);
	});

	it('reads no presets from a value it cannot parse', () => {
		const storage = memoryStorage({ [modelPresetsStorage.key]: '{broken' });
		expect(modelPresetsStorage.read(storage)).toEqual([]);
	});
});
