import type { AgentEvent } from '../types.js';
import type { AgentRunProfile } from '../agent-profile.js';
import type { ConversationHistoryMessage } from '../protocol.js';
import type { ProviderApprovalReply, ProviderQuestionReply } from '../interaction-types.js';

export interface ProviderContext {
	readonly sessionId: string;
	readonly workstreamId: string;
	readonly cwd: string;
	readonly model?: string;
	readonly providerSessionId?: string;
	readonly conversationHistory?: readonly ConversationHistoryMessage[];
}

export type ProviderEventListener = (ev: AgentEvent) => void;

export interface ProviderHandle {
	sendPrompt(
		prompt: string,
		runId: string,
		profile?: AgentRunProfile,
		resumeAt?: string,
		freshConversation?: boolean,
	): Promise<void>;
	cancel(runId: string): Promise<void>;
	respondToApproval?(reply: ProviderApprovalReply): Promise<void>;
	respondToQuestion?(reply: ProviderQuestionReply): Promise<void>;
	refreshMcpStatus?(runId: string): Promise<void>;
	close(): Promise<void>;
}

export type ProviderFactory = (
	ctx: ProviderContext,
	emit: ProviderEventListener,
) => Promise<ProviderHandle>;
