import type { StagedAgentAttachment } from '$lib/chat/domain/composer-actions';
import type { AgentIssueReference } from '$lib/chat/domain/issue-reference';
import type { SessionId } from '$lib/chat/domain/session';

export type PendingPromptOrigin = 'composer' | 'queue';

export type PendingUserPrompt = {
	sessionId: SessionId;
	origin: PendingPromptOrigin;
	runId: string | null;
	text: string;
	attachments: readonly StagedAgentAttachment[];
	issueReferences: readonly AgentIssueReference[];
};
