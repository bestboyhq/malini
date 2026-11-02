import {
	normalizeModelPresets,
	type ModelPreset,
} from '$shared/providers/domain/model-preferences';

const MODEL_PRESETS_KEY = 'malini.providers.model-presets:v1';

class ModelPresetsStorage {
	read(storage: Pick<Storage, 'getItem'> | null = browserStorage()): ModelPreset[] {
		try {
			const raw = storage?.getItem(MODEL_PRESETS_KEY);
			return normalizeModelPresets(raw ? JSON.parse(raw) : null);
		} catch {
			return [];
		}
	}

	write(
		presets: readonly ModelPreset[],
		storage: Pick<Storage, 'setItem'> | null = browserStorage(),
	): ModelPreset[] {
		const normalized = normalizeModelPresets(presets);
		try {
			storage?.setItem(MODEL_PRESETS_KEY, JSON.stringify(normalized));
		} catch {}
		return normalized;
	}

	get key(): string {
		return MODEL_PRESETS_KEY;
	}
}

export const modelPresetsStorage = new ModelPresetsStorage();

function browserStorage(): Storage | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}
