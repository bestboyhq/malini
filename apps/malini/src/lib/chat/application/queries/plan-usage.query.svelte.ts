import { planUsageFor, type PlanUsage } from '$lib/chat/domain/plan-usage';
import { planUsageStore } from '$lib/chat/infrastructure/stores/plan-usage.store.svelte';
import { claudeCodeStatusQuery } from '$shared/providers/providers.api';

export { planUsageQuery };

class PlanUsageQuery {
	public readonly data: PlanUsage | null = $derived.by(() => {
		const status = claudeCodeStatusQuery.data;
		if (status.kind !== 'ready') return null;
		return this.of(status.account?.email ?? null);
	});

	of(account: string | null): PlanUsage | null {
		return planUsageFor(planUsageStore.byAccount, account);
	}
}

const planUsageQuery = new PlanUsageQuery();
