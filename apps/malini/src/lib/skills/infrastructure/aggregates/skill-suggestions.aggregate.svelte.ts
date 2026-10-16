import type { SkillPresetSuggestion } from '$contract/skills';
import { skillsService } from '$lib/skills/infrastructure/services/skills.service';

class SkillSuggestionsAggregate {
	presets = $state.raw<readonly SkillPresetSuggestion[]>([]);
	loadState = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');

	async load(): Promise<void> {
		this.loadState = 'loading';
		try {
			this.presets = await skillsService.suggestPresets();
			this.loadState = 'ready';
		} catch (error) {
			this.loadState = 'error';
			throw error;
		}
	}
}

export const skillSuggestionsAggregate = new SkillSuggestionsAggregate();
