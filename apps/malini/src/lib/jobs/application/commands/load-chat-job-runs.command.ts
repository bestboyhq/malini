import { jobRunsAggregate } from '$lib/jobs/infrastructure/aggregates/job-runs.aggregate.svelte';

export { loadChatJobRunsCommand };

function loadChatJobRunsCommand(chatSessionId: string): void {
	void (async () => {
		try {
			await jobRunsAggregate.loadChat(chatSessionId);
		} catch (error) {
			console.error('[malini jobs] could not load the jobs run from this chat', error);
		}
	})();
}
