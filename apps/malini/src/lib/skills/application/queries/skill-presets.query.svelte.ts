import type { SkillPresetRecord } from '$contract/skills';
import { skillPresetsAggregate } from '$lib/skills/infrastructure/aggregates/skill-presets.aggregate.svelte';

export { skillPresetsQuery };

class SkillPresetsQuery {
	public readonly data: readonly SkillPresetRecord[] = $derived(skillPresetsAggregate.presets);
}

const skillPresetsQuery = new SkillPresetsQuery();
