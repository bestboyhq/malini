import { inbox, type Inbox } from '$lib/chat/domain/inbox';
import { agentActivity } from '$lib/chat/infrastructure/aggregates/agent-activity.aggregate.svelte';

export { inboxQuery };

class InboxQuery {
	public readonly data: Inbox = $derived(
		inbox(agentActivity.attentionByWorkstream(), (workstreamId) =>
			agentActivity.contextFor(workstreamId),
		),
	);
}

const inboxQuery = new InboxQuery();
