import type { ChatRequestId } from '$lib/chat/domain/chat-request';
import type { AgentModel } from '$shared/providers/domain/model-id';
import type { ModelRole } from '$shared/providers/domain/model-preferences';
import type { AgentRunProfile } from '$shared/providers/domain/run-profile';
import type { StagedAgentAttachment } from '$lib/chat/domain/composer-actions';
import type { AgentElementReference } from '$lib/chat/domain/element-reference';
import type { AgentIssueReference } from '$lib/chat/domain/issue-reference';
import type { SessionId } from '$lib/chat/domain/session';
import type { AgentTranscriptReference } from '$lib/chat/domain/transcript-reference';

export type PromptPayload = Readonly<{
	prompt: string;
	contextFiles: readonly string[];
	attachments: readonly StagedAgentAttachment[];
	issueReferences: readonly AgentIssueReference[];
	transcriptReferences: readonly AgentTranscriptReference[];
	elementReferences: readonly AgentElementReference[];
	automated?: boolean;
}>;

export type PromptSubmission = PromptPayload &
	Readonly<{
		workstreamId: string;
		sessionId: SessionId | null;
		forceFreshSession: boolean;
		model: AgentModel;
		profile: AgentRunProfile;
	}>;

export type PromptRequest = PromptSubmission & Readonly<{ requestId: ChatRequestId }>;

export type PromptTurn = PromptPayload &
	Readonly<{
		workstreamId: string;
		sessionId: SessionId | null;
		forceFreshSession: boolean;
		role: ModelRole;
		model: AgentModel;
		profile: AgentRunProfile;
	}>;

export type PromptDispatch = PromptPayload &
	Readonly<{
		workstreamId: string;
		sessionId: SessionId;
		role: ModelRole;
		model: AgentModel;
		profile: AgentRunProfile;
		queueId?: string;
		requestId?: string;
	}>;
