import type { AgentDraft } from '$lib/chat/domain/draft';
import { agentDrafts } from '$lib/chat/infrastructure/aggregates/agent-drafts.aggregate.svelte';

export { updateDraftCommand };

function updateDraftCommand(scopeKey: string, patch: Partial<AgentDraft>): void {
	if (patch.text !== undefined) agentDrafts.setText(scopeKey, patch.text);
	if (patch.contextFiles !== undefined) {
		agentDrafts.setContextFiles(scopeKey, patch.contextFiles);
	}
	if (patch.attachments !== undefined) agentDrafts.setAttachments(scopeKey, patch.attachments);
	if (patch.issueReferences !== undefined) {
		agentDrafts.setIssueReferences(scopeKey, patch.issueReferences);
	}
	if (patch.transcriptReferences !== undefined) {
		agentDrafts.setTranscriptReferences(scopeKey, patch.transcriptReferences);
	}
	if (patch.elementReferences !== undefined) {
		agentDrafts.setElementReferences(scopeKey, patch.elementReferences);
	}
}
