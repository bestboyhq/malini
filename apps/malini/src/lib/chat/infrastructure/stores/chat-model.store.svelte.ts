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
import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import {
	hasStoredWorkstreamModelMemory,
	readStoredWorkstreamModel,
	readWorkstreamModelMemory,
	writeWorkstreamModelMemory,
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
	workstreamDefaults: ModelPreferences = $state({
		planning: { ...DEFAULT_MODEL_PREFERENCES.planning },
		implementation: { ...DEFAULT_MODEL_PREFERENCES.implementation },
	});
	workstreamPreferences: ModelPreferences = $state({
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

	loadPreferencesFor(workstreamId: string): {
		defaults: ModelPreferences;
		memory: ModelPreferences;
	} {
		const defaults = modelDefaultsQuery.data;
		const hadMemory = hasStoredWorkstreamModelMemory(workstreamId);
		let memory = readWorkstreamModelMemory(workstreamId, defaults);
		if (!hadMemory) {
			const legacyModel = readStoredWorkstreamModel(workstreamId);
			if (legacyModel) {
				memory = preferencesWithRoleSelection(memory, 'implementation', { model: legacyModel });
			}
			memory = writeWorkstreamModelMemory(workstreamId, memory, defaults);
		}
		return { defaults, memory };
	}

	adoptDefaults(workstreamId: string): void {
		this.workstreamDefaults = modelDefaultsQuery.data;
		this.workstreamPreferences = writeWorkstreamModelMemory(
			workstreamId,
			this.workstreamDefaults,
			this.workstreamDefaults,
		);
	}

	rememberRoleSelection(
		workstreamId: string,
		role: ModelRole,
		selection: ModelSelection,
	): ModelPreferences {
		const active = chatRoute.workstreamId === workstreamId;
		const defaults = active ? this.workstreamDefaults : modelDefaultsQuery.data;
		const current = active
			? this.workstreamPreferences
			: readWorkstreamModelMemory(workstreamId, defaults);
		const next = preferencesWithRoleSelection(current, role, selection);
		const persisted = writeWorkstreamModelMemory(workstreamId, next, defaults);
		if (active) this.workstreamPreferences = persisted;
		return persisted;
	}
}

export const chatModelStore = new ChatModelStore();
