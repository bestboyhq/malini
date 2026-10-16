import type { EventEnvelope } from '$lib/chat/domain/events';
import {
	planUsageOf,
	withNewerPlanUsage,
	type PlanUsageByAccount,
} from '$lib/chat/domain/plan-usage';

class PlanUsageStore {
	byAccount: PlanUsageByAccount = $state.raw({});

	observe(envelopes: readonly EventEnvelope[]): void {
		let byAccount = this.byAccount;
		for (const { event } of envelopes) {
			const usage = planUsageOf(event);
			if (usage) byAccount = withNewerPlanUsage(byAccount, usage);
		}
		if (byAccount !== this.byAccount) this.byAccount = byAccount;
	}
}

export const planUsageStore = new PlanUsageStore();
