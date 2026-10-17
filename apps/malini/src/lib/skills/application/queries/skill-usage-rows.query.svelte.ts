import { skillUsageRows, type SkillUsageRow } from '$lib/skills/domain/skill-usage';
import { skillCatalogAggregate } from '$lib/skills/infrastructure/aggregates/skill-catalog.aggregate.svelte';
import { skillUsageAggregate } from '$lib/skills/infrastructure/aggregates/skill-usage.aggregate.svelte';

export { skillUsageRowsQuery };

class SkillUsageRowsQuery {
	public readonly data: readonly SkillUsageRow[] = $derived.by(() => {
		const { report } = skillUsageAggregate.usage;
		if (report === null) return [];
		return skillUsageRows(skillCatalogAggregate.catalog(null).skills, report);
	});
}

const skillUsageRowsQuery = new SkillUsageRowsQuery();
