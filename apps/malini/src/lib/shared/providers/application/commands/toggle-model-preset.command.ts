import { toggleModelPreset, type ModelPreset } from '$shared/providers/domain/model-preferences';
import { modelPresetsStorage } from '$shared/providers/infrastructure/services/model-presets.storage';
import { modelPresetsStore } from '$shared/providers/infrastructure/stores/model-presets.store.svelte';

export { toggleModelPresetCommand };

function toggleModelPresetCommand(preset: ModelPreset): void {
	modelPresetsStore.set(
		modelPresetsStorage.write(toggleModelPreset(modelPresetsStorage.read(), preset)),
	);
}
