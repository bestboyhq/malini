import { toast } from '$hyper-ui/components/toast';
import { skillPresetsAggregate } from '$lib/skills/infrastructure/aggregates/skill-presets.aggregate.svelte';
import { skillsService } from '$lib/skills/infrastructure/services/skills.service';

export { setDefaultSkillPresetCommand };

function setDefaultSkillPresetCommand(presetId: string | null): void {
	const previous = skillPresetsAggregate.presets;
	skillPresetsAggregate.replaceAll(
		previous.map((preset) => ({ ...preset, isDefault: preset.id === presetId })),
	);
	void (async () => {
		try {
			skillPresetsAggregate.replaceAll(await skillsService.setDefaultPreset(presetId));
		} catch (error) {
			skillPresetsAggregate.replaceAll(previous);
			toast.error(
				`Could not change the default preset · ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	})();
}
