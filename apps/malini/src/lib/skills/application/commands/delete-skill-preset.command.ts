import { toast } from '$hyper-ui/components/toast';
import { skillPresetsAggregate } from '$lib/skills/infrastructure/aggregates/skill-presets.aggregate.svelte';
import { skillsService } from '$lib/skills/infrastructure/services/skills.service';

export { deleteSkillPresetCommand };

function deleteSkillPresetCommand(presetId: string): void {
	const preset = skillPresetsAggregate.find(presetId);
	if (!preset) return;
	skillPresetsAggregate.remove(presetId);
	void (async () => {
		try {
			await skillsService.deletePreset(presetId);
		} catch (error) {
			skillPresetsAggregate.upsert(preset);
			toast.error(
				`Could not delete ${preset.name} · ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	})();
}
