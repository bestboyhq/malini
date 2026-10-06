import type { StagedAgentAttachment } from '$lib/chat/domain/composer-actions';
import type { ChatRequestId } from '$lib/chat/domain/chat-request';
import type { AgentElementReference } from '$lib/chat/domain/element-reference';
import type { AgentIssueReference } from '$lib/chat/domain/issue-reference';
import type { AgentTranscriptReference } from '$lib/chat/domain/transcript-reference';

export type UndoRunRequest = Readonly<{
	requestId: ChatRequestId;
	runId: string;
	checkpointId: string;
}>;

export type RedoCheckpointRequest = Readonly<{
	requestId: ChatRequestId;
	restoreSeq: number;
}>;

export type EditCheckpointRequest = Readonly<{
	requestId: ChatRequestId;
	checkpointId: string;
	prompt: string;
	contextFiles: readonly string[];
	attachments: readonly StagedAgentAttachment[];
	issueReferences: readonly AgentIssueReference[];
	transcriptReferences: readonly AgentTranscriptReference[];
	elementReferences: readonly AgentElementReference[];
}>;

export const REDO_NEEDS_BRANCH = 'branch instead';

export function redoFailureOffersBranch(error: string | null): boolean {
	return error !== null && error.includes(REDO_NEEDS_BRANCH);
}
