import { skillBoardStore } from '$lib/skills/infrastructure/stores/skill-board.store.svelte';

export { renamingSkillPresetQuery };

class RenamingSkillPresetQuery {
	public readonly data: string | null = $derived(skillBoardStore.renamingPresetId);
}

const renamingSkillPresetQuery = new RenamingSkillPresetQuery();
