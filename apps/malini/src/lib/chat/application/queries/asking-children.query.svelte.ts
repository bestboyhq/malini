import type { JobRunRecord } from '$contract/jobs';
import { askingChildren, type AskingChild } from '$lib/chat/domain/child-requests';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { activeWorkstreamsQuery } from '$shared/repositories/repositories.api';

export { askingChildrenQuery };

class AskingChildrenQuery {
	public readonly data: (
		workstreamId: string,
		shownSessionId: string | null,
		jobRuns: readonly JobRunRecord[],
	) => AskingChild[] = $derived.by(() => {
		const sessions = sessionsAggregate.listSessions();
		const workstreams = activeWorkstreamsQuery.data;
		return (workstreamId, shownSessionId, jobRuns) => {
			const children = new Set(
				workstreams
					.filter((workstream) => workstream.startedBy === workstreamId)
					.map((workstream) => workstream.id),
			);
			return askingChildren(
				shownSessionId,
				jobRuns,
				sessions.filter((session) => children.has(session.workstreamId)),
			);
		};
	});
}

const askingChildrenQuery = new AskingChildrenQuery();
