import { toast } from '$hyper-ui/components/toast';
import { skillPresetsAggregate } from '$lib/skills/infrastructure/aggregates/skill-presets.aggregate.svelte';
import { skillsService } from '$lib/skills/infrastructure/services/skills.service';
import { skillBoardStore } from '$lib/skills/infrastructure/stores/skill-board.store.svelte';

export { createSkillPresetCommand };

function createSkillPresetCommand(
	name: string,
	skills: readonly string[] = [],
	rename = false,
): void {
	const first = skillPresetsAggregate.presets.length === 0;
	void (async () => {
		try {
			const created = await skillsService.savePreset({ name, skills });
			skillPresetsAggregate.upsert(created);
			if (rename) skillBoardStore.renamingPresetId = created.id;
			if (first) skillPresetsAggregate.replaceAll(await skillsService.setDefaultPreset(created.id));
		} catch (error) {
			toast.error(`Could not create ${name} · ${describe(error)}`);
		}
	})();
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
