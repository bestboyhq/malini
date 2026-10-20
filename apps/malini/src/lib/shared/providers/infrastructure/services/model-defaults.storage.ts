import {
	DEFAULT_MODEL_PREFERENCES,
	normalizeModelPreferences,
	type ModelPreferences,
} from '$shared/providers/domain/model-preferences';

const MODEL_DEFAULTS_KEY = 'malini.providers.model-defaults:v1';

class ModelDefaultsStorage {
	read(storage: Pick<Storage, 'getItem' | 'setItem'> | null = browserStorage()): ModelPreferences {
		return normalizeModelPreferences(
			readJson(MODEL_DEFAULTS_KEY, storage),
			DEFAULT_MODEL_PREFERENCES,
		);
	}

	write(
		preferences: ModelPreferences,
		storage: Pick<Storage, 'getItem' | 'setItem'> | null = browserStorage(),
	): ModelPreferences {
		const normalized = normalizeModelPreferences(preferences, DEFAULT_MODEL_PREFERENCES);
		writeJson(MODEL_DEFAULTS_KEY, normalized, storage);
		return normalized;
	}

	get key(): string {
		return MODEL_DEFAULTS_KEY;
	}
}

export const modelDefaultsStorage = new ModelDefaultsStorage();

function readJson(key: string, storage: Pick<Storage, 'getItem' | 'setItem'> | null): unknown {
	try {
		const raw = storage?.getItem(key);
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}

function writeJson(
	key: string,
	value: unknown,
	storage: Pick<Storage, 'getItem' | 'setItem'> | null,
): void {
	try {
		storage?.setItem(key, JSON.stringify(value));
	} catch {}
}

function browserStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}
