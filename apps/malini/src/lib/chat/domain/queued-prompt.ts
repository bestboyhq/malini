import type { AgentModel } from '$shared/providers/domain/model-id';
import type { ModelRole } from '$shared/providers/domain/model-preferences';
import type { AgentRunProfile } from '$shared/providers/domain/run-profile';
import type { StagedAgentAttachment } from './composer-actions';
import type { AgentElementReference } from './element-reference';
import type { SessionId } from './session';
import type { AgentTranscriptReference } from './transcript-reference';

export interface QueuedPrompt {
	id: string;
	targetSessionId: SessionId | null;
	forceFreshSession: boolean;
	prompt: string;
	role: ModelRole;
	provider: string;
	model: AgentModel;
	contextFiles: string[];
	attachments: StagedAgentAttachment[];
	transcriptReferences: AgentTranscriptReference[];
	elementReferences: AgentElementReference[];
	profile: AgentRunProfile;
	automated: boolean;
	createdAt: number;
}
