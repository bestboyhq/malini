import type { StagedAgentAttachment } from './composer-actions';
import type { AgentElementReference } from './element-reference';
import type { AgentIssueReference } from './issue-reference';
import type { SessionId } from './session';
import type { AgentTranscriptReference } from './transcript-reference';

export function agentDraftScopeKey(workstreamId: string, sessionId: SessionId | null): string {
	if (!workstreamId) return '';
	return `${workstreamId}|${sessionId ?? 'new'}`;
}

export type AgentDraft = {
	text: string;
	contextFiles: readonly string[];
	attachments: readonly StagedAgentAttachment[];
	issueReferences: readonly AgentIssueReference[];
	transcriptReferences: readonly AgentTranscriptReference[];
	elementReferences: readonly AgentElementReference[];
};
