import { saveSkillPresetCommand } from './save-skill-preset.command';

export { addSkillToPresetCommand };

function addSkillToPresetCommand(presetId: string, skill: string): void {
	saveSkillPresetCommand(presetId, ({ name, skills }) => ({
		name,
		skills: skills.includes(skill) ? skills : [...skills, skill],
	}));
}
