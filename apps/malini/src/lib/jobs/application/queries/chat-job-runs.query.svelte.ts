import type { JobRunRecord } from '$contract/jobs';
import { jobRunsAggregate } from '$lib/jobs/infrastructure/aggregates/job-runs.aggregate.svelte';

export { chatJobRunsQuery };

class ChatJobRunsQuery {
	public readonly data: (chatSessionId: string) => readonly JobRunRecord[] = $derived(
		(chatSessionId: string) =>
			jobRunsAggregate.runs
				.filter((run) => run.chatSessionId === chatSessionId)
				.sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
	);
}

const chatJobRunsQuery = new ChatJobRunsQuery();
