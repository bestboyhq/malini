import type { AgentEvent } from '../types.js';
import type { AgentRunProfile, AgentTheme } from '../agent-profile.js';
import type {
	BrowserRequest,
	BrowserResult,
	ConversationHistoryMessage,
	PlatformRequest,
	PlatformResult,
} from '../protocol.js';
import type { ProviderApprovalReply, ProviderQuestionReply } from '../interaction-types.js';

export interface ProviderContext {
	readonly sessionId: string;
	readonly workstreamId: string;
	readonly cwd: string;
	readonly model?: string;
	readonly providerSessionId?: string;
	readonly conversationHistory?: readonly ConversationHistoryMessage[];
	readonly requestBrowser: BrowserRequester;
	readonly requestPlatform: PlatformRequester;
}

export type BrowserRequester = (request: BrowserRequest) => Promise<BrowserResult>;

export type PlatformRequester = (request: PlatformRequest) => Promise<PlatformResult>;

export type ProviderEventListener = (ev: AgentEvent) => void;

export interface ProviderHandle {
	sendPrompt(
		prompt: string,
		runId: string,
		profile?: AgentRunProfile,
		resumeAt?: string,
		freshConversation?: boolean,
		skills?: readonly string[],
		steer?: boolean,
		theme?: AgentTheme,
	): Promise<void>;
	cancel(runId: string): Promise<void>;
	respondToApproval?(reply: ProviderApprovalReply): Promise<void>;
	respondToQuestion?(reply: ProviderQuestionReply): Promise<void>;
	refreshSessionStatus?(): Promise<void>;
	authorizeMcpServer?(serverName: string): Promise<string | null>;
	reconnectMcpServer?(serverName: string): Promise<void>;
	stopTask?(runId: string, taskId: string): Promise<void>;
	close(): Promise<void>;
}

export type ProviderFactory = (
	ctx: ProviderContext,
	emit: ProviderEventListener,
) => Promise<ProviderHandle>;
