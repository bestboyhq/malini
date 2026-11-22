import type { PlanSync } from '$contract/initiatives';
import { planSyncAggregate } from '$lib/initiatives/infrastructure/aggregates/plan-sync.aggregate.svelte';

export { planSyncQuery };

class PlanSyncQuery {
	public readonly data: (repositoryFullName: string) => PlanSync | null = $derived(
		(repositoryFullName: string) => planSyncAggregate.states[repositoryFullName] ?? null,
	);
}

const planSyncQuery = new PlanSyncQuery();
