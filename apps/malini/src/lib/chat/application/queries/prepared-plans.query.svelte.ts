import {
	newestWorkstreamChats,
	preparedPlans,
	type PreparedPlan,
} from '$lib/chat/domain/prepared-plan';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';

export { preparedPlansQuery };

class PreparedPlansQuery {
	public readonly data: (workstreamId: string) => readonly PreparedPlan[] = $derived(
		(workstreamId: string) =>
			preparedPlans(newestWorkstreamChats(sessionsAggregate.listSessions(), workstreamId), (id) =>
				sessionsAggregate.listEventsFor(id),
			),
	);
}

const preparedPlansQuery = new PreparedPlansQuery();
