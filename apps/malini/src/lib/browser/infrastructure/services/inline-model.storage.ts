import { persistedAgentModel, type AgentModel } from '$shared/providers/providers.api';

const INLINE_MODEL_KEY = 'malini.browser.inline-model:v1';

type ModelStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readInlineModel(storage: ModelStorage | null = modelStorage()): AgentModel | null {
	try {
		return persistedAgentModel(storage?.getItem(INLINE_MODEL_KEY));
	} catch {
		return null;
	}
}

export function rememberInlineModel(
	model: AgentModel,
	storage: ModelStorage | null = modelStorage(),
): void {
	try {
		storage?.setItem(INLINE_MODEL_KEY, model);
	} catch {}
}

function modelStorage(): ModelStorage | null {
	return globalThis.localStorage ?? null;
}
