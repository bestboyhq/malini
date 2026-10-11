import { agentActivity } from '$lib/chat/infrastructure/aggregates/agent-activity.aggregate.svelte';

export { dismissInboxEntryCommand };

function dismissInboxEntryCommand(workstreamId: string): void {
	agentActivity.clear(workstreamId);
}
