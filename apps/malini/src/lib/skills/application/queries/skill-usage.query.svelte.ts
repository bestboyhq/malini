import type { SkillUsage } from '$lib/skills/domain/skill-usage';
import { skillUsageAggregate } from '$lib/skills/infrastructure/aggregates/skill-usage.aggregate.svelte';

export { skillUsageQuery };

class SkillUsageQuery {
	public readonly data: SkillUsage = $derived(skillUsageAggregate.usage);
}

const skillUsageQuery = new SkillUsageQuery();
