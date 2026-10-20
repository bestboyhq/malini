import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';
import { transcriptAggregate } from '$lib/chat/infrastructure/aggregates/transcript.aggregate.svelte';

export { workstreamRunEndsQuery };

class WorkstreamRunEndsQuery {
	public readonly data: (workstreamId: string) => string = $derived((workstreamId: string) =>
		sessionsAggregate
			.listSessions()
			.filter((session) => session.workstreamId === workstreamId)
			.map((session) => transcriptAggregate.summaryFor(session.id).latestTerminalKey ?? '')
			.join('|'),
	);
}

const workstreamRunEndsQuery = new WorkstreamRunEndsQuery();
