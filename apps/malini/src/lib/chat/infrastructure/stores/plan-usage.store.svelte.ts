import type { EventEnvelope } from '$lib/chat/domain/events';
import { newerPlanUsage, planUsageOf, type PlanUsage } from '$lib/chat/domain/plan-usage';

class PlanUsageStore {
	latest: PlanUsage | null = $state(null);

	observe(envelopes: readonly EventEnvelope[]): void {
		let latest = this.latest;
		for (const { event } of envelopes) {
			const usage = planUsageOf(event);
			if (usage) latest = newerPlanUsage(latest, usage);
		}
		if (latest !== this.latest) this.latest = latest;
	}
}

export const planUsageStore = new PlanUsageStore();
