import {
	DEFAULT_PROVIDER_ID,
	defaultAgentModel,
	modelSelectionValue,
	normalizeModelSelection,
	type ModelSelection,
} from '$shared/providers/providers.api';

const INLINE_MODEL_KEY = 'malini.browser.inline-model:v1';

type ModelStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readInlineModel(storage: ModelStorage | null = modelStorage()): ModelSelection | null {
	try {
		const raw = storage?.getItem(INLINE_MODEL_KEY);
		if (raw === null || raw === undefined) return null;
		const parsed: unknown = JSON.parse(raw);
		return normalizeModelSelection(
			typeof parsed === 'string' ? { model: parsed } : parsed,
			{ provider: DEFAULT_PROVIDER_ID, model: defaultAgentModel() },
		);
	} catch {
		return null;
	}
}

export function rememberInlineModel(
	selection: ModelSelection,
	storage: ModelStorage | null = modelStorage(),
): void {
	try {
		storage?.setItem(INLINE_MODEL_KEY, modelSelectionValue(selection));
	} catch {}
}

function modelStorage(): ModelStorage | null {
	return globalThis.localStorage ?? null;
}
