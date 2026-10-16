import { skillCatalogAggregate } from '$lib/skills/infrastructure/aggregates/skill-catalog.aggregate.svelte';

export { ensureSkillCatalogCommand };

function ensureSkillCatalogCommand(workstreamId: string | null): void {
	if (skillCatalogAggregate.catalog(workstreamId).state !== 'idle') return;
	void skillCatalogAggregate.load(workstreamId);
}
