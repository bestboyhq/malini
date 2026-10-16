import { saveSkillPresetCommand } from './save-skill-preset.command';

export { removeSkillFromPresetCommand };

function removeSkillFromPresetCommand(presetId: string, skill: string): void {
	saveSkillPresetCommand(presetId, ({ name, skills }) => ({
		name,
		skills: skills.filter((existing) => existing !== skill),
	}));
}
