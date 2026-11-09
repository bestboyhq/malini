import type { EventEnvelope } from '$lib/chat/domain/events';
import {
	planUsageOf,
	withNewerPlanUsage,
	type PlanUsage,
	type PlanUsageByAccount,
} from '$lib/chat/domain/plan-usage';

class PlanUsageStore {
	byAccount: PlanUsageByAccount = $state.raw({});

	observe(envelopes: readonly EventEnvelope[]): void {
		this.remember(envelopes.flatMap(({ event }) => planUsageOf(event) ?? []));
	}

	remember(readings: readonly PlanUsage[]): void {
		const byAccount = readings.reduce(withNewerPlanUsage, this.byAccount);
		if (byAccount !== this.byAccount) this.byAccount = byAccount;
	}
}

export const planUsageStore = new PlanUsageStore();
