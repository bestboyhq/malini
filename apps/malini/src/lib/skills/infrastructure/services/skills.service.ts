import type { SkillRecord, SkillUsageReport, SwitchSkillArgs } from '$contract/skills';
import { invoke } from '$shared/port/invoke';

class SkillsService {
	list(workstreamId: string | null): Promise<SkillRecord[]> {
		return invoke('skills.list', workstreamId === null ? {} : { workstreamId });
	}

	usage(): Promise<SkillUsageReport> {
		return invoke('skills.usage', undefined);
	}

	switchSkill(args: SwitchSkillArgs): Promise<SkillUsageReport> {
		return invoke('skills.switch', args);
	}
}

export const skillsService = new SkillsService();
