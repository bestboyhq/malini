import type { SkillCatalog } from '$lib/skills/domain/skill-catalog';
import { skillCatalogAggregate } from '$lib/skills/infrastructure/aggregates/skill-catalog.aggregate.svelte';

export { skillCatalogQuery };

class SkillCatalogQuery {
	public readonly data: (workstreamId: string | null) => SkillCatalog = $derived(
		(workstreamId: string | null) => skillCatalogAggregate.catalog(workstreamId),
	);
}

const skillCatalogQuery = new SkillCatalogQuery();
