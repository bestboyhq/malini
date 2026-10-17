import { toast } from '$hyper-ui/components/toast';
import { skillPresetsAggregate } from '$lib/skills/infrastructure/aggregates/skill-presets.aggregate.svelte';
import { skillsService } from '$lib/skills/infrastructure/services/skills.service';
import { skillBoardStore } from '$lib/skills/infrastructure/stores/skill-board.store.svelte';

export { createSkillPresetCommand };

type PresetDraft = Readonly<{ name: string; skills: readonly string[]; emoji?: string | null }>;

function createSkillPresetCommand(draft: PresetDraft, rename = false): void {
	const { name } = draft;
	void (async () => {
		try {
			const created = await skillsService.savePreset(draft);
			skillPresetsAggregate.upsert(created);
			if (rename) skillBoardStore.renamingPresetId = created.id;
		} catch (error) {
			toast.error(`Could not create ${name} · ${describe(error)}`);
		}
	})();
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
