import { SKILL_PRESET_NAME_MAX_LENGTH } from '$contract/skills';
import { skillBoardStore } from '$lib/skills/infrastructure/stores/skill-board.store.svelte';
import { saveSkillPresetCommand } from './save-skill-preset.command';

export { renameSkillPresetCommand };

function renameSkillPresetCommand(presetId: string, name: string): void {
	skillBoardStore.renamingPresetId = null;
	const trimmed = name.trim().slice(0, SKILL_PRESET_NAME_MAX_LENGTH);
	if (trimmed.length === 0) return;
	saveSkillPresetCommand(presetId, ({ skills }) => ({ name: trimmed, skills }));
}
