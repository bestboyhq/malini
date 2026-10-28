import type { ChatDelivery } from '$contract/deliveries';
import type { LeadDecision } from '$contract/leads';

class LeadDecisionsAggregate {
	bySession = $state.raw<ReadonlyMap<string, readonly LeadDecision[]>>(new Map());
	deliveries = $state.raw<ReadonlyMap<string, ChatDelivery>>(new Map());

	replace(sessionId: string, decisions: readonly LeadDecision[]): void {
		this.bySession = new Map(this.bySession).set(sessionId, decisions);
	}

	apply(decision: LeadDecision): void {
		const known = this.bySession.get(decision.sessionId);
		if (!known) return;
		const at = known.findIndex((entry) => entry.id === decision.id);
		const next =
			at === -1
				? [...known, decision]
				: known.map((entry, index) => (index === at ? decision : entry));
		this.bySession = new Map(this.bySession).set(decision.sessionId, next);
	}

	replaceDeliveries(deliveries: readonly ChatDelivery[]): void {
		const next = new Map(this.deliveries);
		for (const delivery of deliveries) next.set(delivery.id, delivery);
		this.deliveries = next;
	}

	applyDelivery(delivery: ChatDelivery): void {
		this.deliveries = new Map(this.deliveries).set(delivery.id, delivery);
	}
}

export const leadDecisionsAggregate = new LeadDecisionsAggregate();
