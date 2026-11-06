import type { AutomationRunRecord } from '$contract/automations';
import {
	askingChildren,
	descendantWorkstreamIds,
	type AskingChild,
} from '$lib/chat/domain/child-requests';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { activeWorkstreamsQuery } from '$shared/repositories/repositories.api';

export { askingChildrenQuery };

class AskingChildrenQuery {
	public readonly data: (
		workstreamId: string,
		shownSessionId: string | null,
		automationRuns: readonly AutomationRunRecord[],
	) => AskingChild[] = $derived.by(() => {
		const sessions = sessionsAggregate.listSessions();
		const workstreams = activeWorkstreamsQuery.data;
		return (workstreamId, shownSessionId, automationRuns) => {
			const descendants = descendantWorkstreamIds(workstreamId, workstreams);
			return askingChildren(
				shownSessionId,
				automationRuns,
				sessions.filter((session) => descendants.has(session.workstreamId)),
			);
		};
	});
}

const askingChildrenQuery = new AskingChildrenQuery();
