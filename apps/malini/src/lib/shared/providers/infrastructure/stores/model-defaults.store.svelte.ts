import {
	DEFAULT_MODEL_PREFERENCES,
	type ModelPreferences,
} from '$shared/providers/domain/model-preferences';

class ModelDefaultsStore {
	preferences = $state<ModelPreferences>({
		planning: { ...DEFAULT_MODEL_PREFERENCES.planning },
		implementation: { ...DEFAULT_MODEL_PREFERENCES.implementation },
	});

	set(preferences: ModelPreferences): void {
		this.preferences = preferences;
	}
}

export const modelDefaultsStore = new ModelDefaultsStore();
