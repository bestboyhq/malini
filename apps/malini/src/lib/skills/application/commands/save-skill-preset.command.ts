import type { SkillPresetRecord } from '$contract/skills';
import { toast } from '$hyper-ui/components/toast';
import { skillPresetsAggregate } from '$lib/skills/infrastructure/aggregates/skill-presets.aggregate.svelte';
import { skillsService } from '$lib/skills/infrastructure/services/skills.service';

export { saveSkillPresetCommand };

function saveSkillPresetCommand(
	presetId: string,
	change: (
		preset: SkillPresetRecord,
	) => Partial<Pick<SkillPresetRecord, 'name' | 'skills' | 'emoji'>>,
): void {
	const previous = skillPresetsAggregate.find(presetId);
	if (!previous) return;
	const next = { ...previous, ...change(previous) };
	skillPresetsAggregate.upsert(next);
	void (async () => {
		try {
			skillPresetsAggregate.upsert(
				await skillsService.savePreset({
					id: presetId,
					name: next.name,
					emoji: next.emoji,
					skills: next.skills,
				}),
			);
		} catch (error) {
			skillPresetsAggregate.upsert(previous);
			toast.error(
				`Could not save ${previous.name} · ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	})();
}
