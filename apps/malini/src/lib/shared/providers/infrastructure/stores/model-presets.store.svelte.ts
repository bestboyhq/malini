import type { ModelPreset } from '$shared/providers/domain/model-preferences';
import { modelPresetsStorage } from '$shared/providers/infrastructure/services/model-presets.storage';

class ModelPresetsStore {
	presets: ModelPreset[] = $state(modelPresetsStorage.read());

	set(presets: ModelPreset[]): void {
		this.presets = presets;
	}
}

export const modelPresetsStore = new ModelPresetsStore();
