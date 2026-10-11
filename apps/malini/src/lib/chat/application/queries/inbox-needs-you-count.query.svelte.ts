import { inbox } from '$lib/chat/domain/inbox';
import { agentActivity } from '$lib/chat/infrastructure/aggregates/agent-activity.aggregate.svelte';

export { inboxNeedsYouCountQuery };

class InboxNeedsYouCountQuery {
	public readonly data: number = $derived(
		inbox(agentActivity.attentionByWorkstream(), (workstreamId) =>
			agentActivity.contextFor(workstreamId),
		).needsYou.length,
	);
}

const inboxNeedsYouCountQuery = new InboxNeedsYouCountQuery();
