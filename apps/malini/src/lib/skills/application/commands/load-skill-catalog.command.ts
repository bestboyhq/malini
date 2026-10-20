import { skillCatalogAggregate } from '$lib/skills/infrastructure/aggregates/skill-catalog.aggregate.svelte';

export { loadSkillCatalogCommand };

function loadSkillCatalogCommand(workstreamId: string | null): void {
	void skillCatalogAggregate.load(workstreamId);
}
