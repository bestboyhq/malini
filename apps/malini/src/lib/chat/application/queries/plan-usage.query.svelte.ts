import type { PlanUsage } from '$lib/chat/domain/plan-usage';
import { planUsageStore } from '$lib/chat/infrastructure/stores/plan-usage.store.svelte';

export { planUsageQuery };

class PlanUsageQuery {
	public readonly data: PlanUsage | null = $derived(planUsageStore.latest);
}

const planUsageQuery = new PlanUsageQuery();
