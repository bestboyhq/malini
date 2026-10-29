import type { ChatDelivery } from '$contract/deliveries';
import type { LeadDecision } from '$contract/leads';
import { leadDecisionsAggregate } from '$lib/chat/infrastructure/aggregates/lead-decisions.aggregate.svelte';
import { leadDecisionFocusStore } from '$lib/chat/infrastructure/stores/lead-decision-focus.store.svelte';

const NONE: readonly LeadDecision[] = [];

class LeadDecisionsQuery {
	public readonly data: (sessionId: string | null) => readonly LeadDecision[] = $derived(
		(sessionId: string | null) =>
			sessionId === null ? NONE : (leadDecisionsAggregate.bySession.get(sessionId) ?? NONE),
	);

	public readonly open: (sessionId: string | null) => readonly LeadDecision[] = $derived(
		(sessionId: string | null) => this.data(sessionId).filter((decision) => !decision.answer),
	);

	public readonly delivery: (id: string | null) => ChatDelivery | null = $derived(
		(id: string | null) =>
			id === null ? null : (leadDecisionsAggregate.deliveries.get(id) ?? null),
	);

	public readonly focus = $derived({
		focusedId: leadDecisionFocusStore.focusedId,
		asideIds: leadDecisionFocusStore.asideIds,
		viewing: leadDecisionFocusStore.viewing,
	});
}

export const leadDecisionsQuery = new LeadDecisionsQuery();
