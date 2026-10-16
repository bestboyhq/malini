import { skillTokens } from '$lib/skills/domain/skill-groups';
import { skillCatalogAggregate } from '$lib/skills/infrastructure/aggregates/skill-catalog.aggregate.svelte';

export { skillCatalogTotalsQuery };

type SkillCatalogTotals = Readonly<{ skills: number; tokens: number }>;

class SkillCatalogTotalsQuery {
	public readonly data: (workstreamId: string | null) => SkillCatalogTotals | null = $derived(
		(workstreamId: string | null) => {
			const { skills, state } = skillCatalogAggregate.catalog(workstreamId);
			if (state !== 'ready') return null;
			return { skills: skills.length, tokens: skillTokens(skills, 'all') };
		},
	);
}

const skillCatalogTotalsQuery = new SkillCatalogTotalsQuery();
