import { claudeModelFor, isValidAgentModel, type AgentModel } from './model-id';

export type ModelRole = 'planning' | 'implementation';

export type ModelSelection = {
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
	planning: { model: 'opus' },
	implementation: { model: 'default' },
};

export function roleForAgentMode(mode: 'agent' | 'plan'): ModelRole {
	return mode === 'plan' ? 'planning' : 'implementation';
}

export function selectionForRole(preferences: ModelPreferences, role: ModelRole): ModelSelection {
	return cloneModelSelection(preferences[role]);
}

export function sameModelSelection(left: ModelSelection, right: ModelSelection): boolean {
	return left.model === right.model;
}

export function cloneModelSelection(selection: ModelSelection): ModelSelection {
	return { model: selection.model };
}

export function isValidModelSelection(value: unknown): value is ModelSelection {
	return isRecord(value) && isValidAgentModel(value.model);
}

export function normalizeModelPreferences(
	value: unknown,
	fallback: ModelPreferences,
): ModelPreferences {
	const candidate: Record<string, unknown> = isRecord(value) ? value : {};
	return {
		planning: storedSelection(candidate.planning, fallback.planning),
		implementation: storedSelection(candidate.implementation, fallback.implementation),
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

function storedSelection(value: unknown, fallback: ModelSelection): ModelSelection {
	if (isValidModelSelection(value)) return cloneModelSelection(value);
	if (isRecord(value) && typeof value.model === 'string' && value.model.startsWith('anthropic/')) {
		return { model: claudeModelFor(value.model) };
	}
	return cloneModelSelection(fallback);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
