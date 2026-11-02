import {
	DEFAULT_AGENT_MODEL,
	claudeModelFor,
	isValidAgentModel,
	type AgentModel,
} from './model-id';
import {
	CLAUDE_PROVIDER_ID,
	DEEPSEEK_MODELS,
	DEEPSEEK_PROVIDER_ID,
	isValidProviderId,
	providerForModel,
	type ProviderModelSource,
} from './provider';

export type ModelRole = 'planning' | 'implementation';

export type ModelSelection = {
	provider: string;
	model: AgentModel;
};

export type ModelPreferences = {
	planning: ModelSelection;
	implementation: ModelSelection;
};

export type ChatModelSnapshot = {
	role: ModelRole;
	selection: ModelSelection;
};

export const DEFAULT_MODEL_PREFERENCES: ModelPreferences = {
	planning: { provider: CLAUDE_PROVIDER_ID, model: 'opus' },
	implementation: { provider: CLAUDE_PROVIDER_ID, model: DEFAULT_AGENT_MODEL },
};

export function roleForAgentMode(mode: 'agent' | 'plan'): ModelRole {
	return mode === 'plan' ? 'planning' : 'implementation';
}

export function selectionForRole(preferences: ModelPreferences, role: ModelRole): ModelSelection {
	return cloneModelSelection(preferences[role]);
}

export function sameModelSelection(left: ModelSelection, right: ModelSelection): boolean {
	return left.provider === right.provider && left.model === right.model;
}

export function cloneModelSelection(selection: ModelSelection): ModelSelection {
	return { provider: selection.provider, model: selection.model };
}

export function isValidModelSelection(value: unknown): value is ModelSelection {
	return isRecord(value) && isValidProviderId(value.provider) && isValidAgentModel(value.model);
}

export function modelSelectionValue(selection: ModelSelection): string {
	return JSON.stringify({ provider: selection.provider, model: selection.model });
}

export function parseModelSelectionValue(value: string, fallback: ModelSelection): ModelSelection {
	try {
		const parsed: unknown = JSON.parse(value);
		return normalizeModelSelection(parsed, fallback);
	} catch {
		return fallback;
	}
}

export function normalizeModelSelection(
	value: unknown,
	fallback: ModelSelection,
	providers: readonly ProviderModelSource[] = [],
): ModelSelection {
	if (isValidModelSelection(value)) return cloneModelSelection(value);
	if (isRecord(value) && typeof value.model === 'string') {
		const model = value.model.startsWith('anthropic/')
			? claudeModelFor(value.model)
			: isValidAgentModel(value.model)
				? value.model
				: null;
		if (model !== null) {
			return {
				provider: isValidProviderId(value.provider)
					? value.provider
					: providerForModel(model, providerSources(providers)),
				model,
			};
		}
	}
	return cloneModelSelection(fallback);
}

export function normalizeModelPreferences(
	value: unknown,
	fallback: ModelPreferences,
	providers: readonly ProviderModelSource[] = [],
): ModelPreferences {
	const candidate: Record<string, unknown> = isRecord(value) ? value : {};
	return {
		planning: normalizeModelSelection(candidate['planning'], fallback.planning, providers),
		implementation: normalizeModelSelection(
			candidate['implementation'],
			fallback.implementation,
			providers,
		),
	};
}

export function preferencesWithRoleSelection(
	preferences: ModelPreferences,
	role: ModelRole,
	selection: ModelSelection,
): ModelPreferences {
	if (!isValidModelSelection(selection)) {
		throw new Error(`Invalid ${role} model selection`);
	}
	return {
		planning: cloneModelSelection(preferences.planning),
		implementation: cloneModelSelection(preferences.implementation),
		[role]: cloneModelSelection(selection),
	};
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function providerSources(providers: readonly ProviderModelSource[]): ProviderModelSource[] {
	const presets: ProviderModelSource = {
		id: DEEPSEEK_PROVIDER_ID,
		models: DEEPSEEK_MODELS.map(({ id }) => id),
	};
	const known = providers.some((provider) => provider.id === DEEPSEEK_PROVIDER_ID);
	return known ? [...providers] : [...providers, presets];
}
