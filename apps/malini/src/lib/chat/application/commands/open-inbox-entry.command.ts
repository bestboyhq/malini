import { agentActivity } from '$lib/chat/infrastructure/aggregates/agent-activity.aggregate.svelte';
import { goto } from '$shared/router/navigation';
import { workstreamHref } from '$shared/router/routes-hrefs';

export { openInboxEntryCommand };

function openInboxEntryCommand(workstreamId: string): void {
	const sessionId = agentActivity.attentionFor(workstreamId)?.sessionId ?? null;
	agentActivity.clear(workstreamId);
	void goto(workstreamHref(workstreamId, { agentSessionId: sessionId }));
}
