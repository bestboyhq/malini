import type { AgentDraft } from '$lib/chat/domain/draft';
import { agentDrafts } from '$lib/chat/infrastructure/aggregates/agent-drafts.aggregate.svelte';

export { composerDraftQuery };

class ComposerDraftQuery {
	public readonly data: (scopeKey: string) => AgentDraft = $derived((scopeKey: string) =>
		agentDrafts.draftFor(scopeKey),
	);
}

const composerDraftQuery = new ComposerDraftQuery();
