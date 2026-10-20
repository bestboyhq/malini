import type {
	SaveSkillPresetArgs,
	SkillPresetRecord,
	SkillRecord,
	SkillUsageReport,
	SwitchSkillArgs,
} from '$contract/skills';
import { invoke } from '$shared/port/invoke';

class SkillsService {
	list(workstreamId: string | null): Promise<SkillRecord[]> {
		return invoke('skills.list', workstreamId === null ? {} : { workstreamId });
	}

	listPresets(): Promise<SkillPresetRecord[]> {
		return invoke('skills.list-presets', undefined);
	}

	savePreset(args: SaveSkillPresetArgs): Promise<SkillPresetRecord> {
		return invoke('skills.save-preset', args);
	}

	async deletePreset(presetId: string): Promise<void> {
		await invoke('skills.delete-preset', { presetId });
	}

	usage(): Promise<SkillUsageReport> {
		return invoke('skills.usage', undefined);
	}

	switchSkill(args: SwitchSkillArgs): Promise<SkillUsageReport> {
		return invoke('skills.switch', args);
	}
}

export const skillsService = new SkillsService();
