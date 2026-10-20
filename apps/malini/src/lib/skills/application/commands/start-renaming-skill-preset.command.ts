import { skillBoardStore } from '$lib/skills/infrastructure/stores/skill-board.store.svelte';

export { startRenamingSkillPresetCommand };

function startRenamingSkillPresetCommand(presetId: string | null): void {
	skillBoardStore.renamingPresetId = presetId;
}
