import {
	DEFAULT_AGENT_RUN_PROFILE,
	DEFAULT_MODEL_PREFERENCES,
	defaultAgentModel,
	isValidAgentModel,
	modelDefaultsQuery,
	preferencesWithRoleSelection,
	type AgentModel,
	type AgentRunProfile,
	type ModelPreferences,
	type ModelRole,
	type ModelSelection,
} from '$shared/providers/providers.api';
import type { SessionId } from '$lib/chat/domain/session';
import {
	readModelMemory,
	writeModelMemory,
} from '$lib/chat/infrastructure/services/model-preferences.storage';

class ChatModelStore {
	model: AgentModel | null = $state(null);
	profile: AgentRunProfile = $state({ ...DEFAULT_AGENT_RUN_PROFILE });
	preview: Readonly<{ sessionId: SessionId; model: AgentModel; profile: AgentRunProfile }> | null =
		$state.raw(null);
	userChoices = 0;

	noteUserChoice(): void {
		this.userChoices += 1;
	}
	rememberedModels: ModelPreferences = $state({
		planning: { ...DEFAULT_MODEL_PREFERENCES.planning },
		implementation: { ...DEFAULT_MODEL_PREFERENCES.implementation },
	});

	previewFor(sessionId: SessionId | null): ChatModelStore['preview'] {
		return sessionId !== null && this.preview?.sessionId === sessionId ? this.preview : null;
	}

	selectionForSession(record: { model: string | null }): ModelSelection {
		if (isValidAgentModel(record.model)) return { model: record.model };
		return { model: defaultAgentModel() };
	}

	loadRememberedModels(): ModelPreferences {
		this.rememberedModels = readModelMemory(modelDefaultsQuery.data);
		return this.rememberedModels;
	}

	adoptDefaults(): void {
		const defaults = modelDefaultsQuery.data;
		this.rememberedModels = writeModelMemory(defaults, defaults);
	}

	rememberRoleSelection(role: ModelRole, selection: ModelSelection): ModelPreferences {
		const defaults = modelDefaultsQuery.data;
		const next = preferencesWithRoleSelection(readModelMemory(defaults), role, selection);
		this.rememberedModels = writeModelMemory(next, defaults);
		return this.rememberedModels;
	}
}

export const chatModelStore = new ChatModelStore();
