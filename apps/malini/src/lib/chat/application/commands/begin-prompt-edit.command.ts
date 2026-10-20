import type { AgentDraft } from '$lib/chat/domain/draft';
import { agentDrafts } from '$lib/chat/infrastructure/aggregates/agent-drafts.aggregate.svelte';
import { updateDraftCommand } from './update-draft.command';

export { beginPromptEditCommand };

function beginPromptEditCommand(scope: string, draft: AgentDraft): void {
	agentDrafts.takeDetached(scope);
	agentDrafts.clear(scope);
	updateDraftCommand(scope, draft);
}
