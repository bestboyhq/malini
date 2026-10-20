import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_PREFERENCES } from '$shared/providers/domain/model-preferences';
import { modelDefaultsStorage } from './model-defaults.storage';

function memoryStorage(seed: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> & {
	values: Map<string, string>;
} {
	const values = new Map(Object.entries(seed));
	return {
		values,
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => {
			values.set(key, value);
		},
	};
}

describe('model defaults storage', () => {
	it('round trips the one set of model defaults', () => {
		const storage = memoryStorage();
		const written = modelDefaultsStorage.write(
			{
				planning: { model: 'opus' },
				implementation: { model: 'sonnet[1m]' },
			},
			storage,
		);

		expect(written).toEqual({
			planning: { model: 'opus' },
			implementation: { model: 'sonnet[1m]' },
		});
		expect(modelDefaultsStorage.read(storage)).toEqual(written);
	});

	it('falls back to the product defaults when the stored value is unusable', () => {
		const storage = memoryStorage({ [modelDefaultsStorage.key]: '{broken' });
		expect(modelDefaultsStorage.read(storage)).toEqual(DEFAULT_MODEL_PREFERENCES);
	});
});
