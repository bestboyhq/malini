import { agentActionsAggregate } from '$lib/jobs/infrastructure/aggregates/agent-actions.aggregate.svelte';

export { loadAgentActionsCommand };

function loadAgentActionsCommand(): void {
	void agentActionsAggregate.load().catch((error: unknown) => {
		console.error('[malini jobs] could not load agent actions', error);
	});
}
