import type {
	SaveSkillPresetArgs,
	SkillChoice,
	SkillPresetRecord,
	SkillPresetSuggestion,
	SkillRecord,
} from '$contract/skills';
import { invoke } from '$shared/port/invoke';

class SkillsService {
	list(workstreamId: string | null): Promise<SkillRecord[]> {
		return invoke('skills.list', workstreamId === null ? {} : { workstreamId });
	}

	listPresets(): Promise<SkillPresetRecord[]> {
		return invoke('skills.list-presets', undefined);
	}

	suggestPresets(): Promise<SkillPresetSuggestion[]> {
		return invoke('skills.suggest-presets', undefined);
	}

	savePreset(args: SaveSkillPresetArgs): Promise<SkillPresetRecord> {
		return invoke('skills.save-preset', args);
	}

	async deletePreset(presetId: string): Promise<void> {
		await invoke('skills.delete-preset', { presetId });
	}

	setDefaultPreset(presetId: string | null): Promise<SkillPresetRecord[]> {
		return invoke('skills.set-default-preset', { presetId });
	}

	choice(workstreamId: string, sessionId: string | null): Promise<SkillChoice> {
		return invoke('skills.choice', { workstreamId, ...(sessionId ? { sessionId } : {}) });
	}

	choose(
		workstreamId: string,
		sessionId: string | null,
		choice: SkillChoice,
	): Promise<SkillChoice> {
		return invoke('skills.choose', {
			workstreamId,
			choice,
			...(sessionId ? { sessionId } : {}),
		});
	}
}

export const skillsService = new SkillsService();
