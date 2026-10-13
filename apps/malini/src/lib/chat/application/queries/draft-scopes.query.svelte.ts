import { agentDrafts } from '$lib/chat/infrastructure/aggregates/agent-drafts.aggregate.svelte';

export { draftScopesQuery };

class DraftScopesQuery {
	public readonly data: (workstreamId: string) => readonly string[] = $derived(
		(workstreamId: string) => agentDrafts.draftScopesFor(workstreamId),
	);
}

const draftScopesQuery = new DraftScopesQuery();
