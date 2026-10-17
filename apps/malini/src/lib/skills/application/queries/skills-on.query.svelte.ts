import type { SkillCatalog } from '$lib/skills/domain/skill-catalog';
import { skillIsOn } from '$lib/skills/domain/skill-usage';
import { skillCatalogAggregate } from '$lib/skills/infrastructure/aggregates/skill-catalog.aggregate.svelte';
import { skillUsageAggregate } from '$lib/skills/infrastructure/aggregates/skill-usage.aggregate.svelte';

export { skillsOnQuery };

class SkillsOnQuery {
	public readonly data: (workstreamId: string | null) => SkillCatalog = $derived(
		(workstreamId: string | null) => {
			const catalog = skillCatalogAggregate.catalog(workstreamId);
			const { report } = skillUsageAggregate.usage;
			return { ...catalog, skills: catalog.skills.filter((skill) => skillIsOn(skill, report)) };
		},
	);
}

const skillsOnQuery = new SkillsOnQuery();
