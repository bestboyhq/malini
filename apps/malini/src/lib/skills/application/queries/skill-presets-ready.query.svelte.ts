import { skillPresetsAggregate } from '$lib/skills/infrastructure/aggregates/skill-presets.aggregate.svelte';

export { skillPresetsReadyQuery };

class SkillPresetsReadyQuery {
	public readonly data: boolean = $derived(skillPresetsAggregate.loadState === 'ready');
}

const skillPresetsReadyQuery = new SkillPresetsReadyQuery();
