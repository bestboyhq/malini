import { saveSkillPresetCommand } from './save-skill-preset.command';

export { setSkillPresetEmojiCommand };

function setSkillPresetEmojiCommand(presetId: string, emoji: string | null): void {
	saveSkillPresetCommand(presetId, () => ({ emoji }));
}
