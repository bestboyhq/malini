import type { SessionStatus } from './agent-state-machine';

export type AgentReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type AgentRunMode = 'agent' | 'plan';

export type AgentAccess = 'sandboxed' | 'auto' | 'full';

export interface AgentRunProfile {
	effort: AgentReasoningEffort;
	mode: AgentRunMode;
	access: AgentAccess;
}

export type ProviderCapabilityState = 'ready' | 'needs_auth' | 'missing' | 'unknown';

export interface AgentModelInfo {
	id: string;
	label: string;
	description: string;
	efforts: AgentReasoningEffort[];
}

export interface AgentAccount {
	email?: string;
	plan?: string;
}

export interface ProviderCapability {
	state: ProviderCapabilityState;
	installed: boolean;
	authenticated: boolean | null;
	version: string | null;
	account: AgentAccount | null;
	models: AgentModelInfo[];
	defaultModel: string;
	message: string;
}

export type ClaudeSetupStep = 'install' | 'sign-in';

export const CLAUDE_SETUP_COMMANDS: Readonly<Record<ClaudeSetupStep, string>> = {
	install: 'curl -fsSL https://claude.ai/install.sh | bash',
	'sign-in': 'claude auth login',
};

export interface AgentQuestionAnswer {
	questionId: string;
	values: readonly string[];
}

export interface AgentEventEnvelope {
	sessionId: string;
	runId: string;
	seq: number;
	event: Record<string, unknown>;
}

export type LiveEventEnvelope = AgentEventEnvelope & { ephemeral?: true };

export interface AgentSessionSummary {
	id: string;
	workstreamId: string;
	displayName: string;
	model: string | null;
	status: SessionStatus;
	startedAt: string;
}

export interface AgentTranscriptReference {
	sessionId: string;
	label: string;
}

export interface AgentElementRect {
	top: number;
	left: number;
	width: number;
	height: number;
}

export interface AgentElementReference {
	url: string;
	domPath: string;
	rect: AgentElementRect;
	html: string;
}

export type AgentApprovalDecision = 'allow' | 'deny';

export type AgentApprovalScope = 'once' | 'session' | 'workstream';

export interface AgentApprovalDecisionResult {
	readonly decision: AgentApprovalDecision;
	readonly scope: AgentApprovalScope;
	readonly remembered: boolean;
	readonly ruleId?: string;
}

export interface StagedAgentAttachment {
	id: string;
	displayName: string;
	relativePath: string;
	mediaType: string;
	size: number;
	sha256: string;
}

export interface StagedAgentAttachmentBytes {
	mediaType: string;
	base64: string;
	size: number;
}

export interface AgentRunChangedFile {
	path: string;
	additions: number;
	deletions: number;
	isBinary: boolean;
}

export interface AgentRunChangeSummary {
	runId: string;
	beforeCommit: string;
	afterCommit: string;
	files: AgentRunChangedFile[];
	capturedAt: string;
}

export interface AgentSessionChangedFile {
	path: string;
	additions: number;
	deletions: number;
	isBinary: boolean;
	runIds: string[];
}

export interface AgentSessionChanges {
	sessionId: string;
	runs: AgentRunChangeSummary[];
	files: AgentSessionChangedFile[];
	beforeCommit: string | null;
	afterCommit: string | null;
	capturedAt: string | null;
}

export interface AgentRunChangePatch {
	runId: string;
	beforeCommit: string;
	afterCommit: string;
	patch: string;
}

export interface AgentSessionChangeTurnPatch {
	runId: string;
	turn: number;
	title: string | null;
	beforeCommit: string;
	afterCommit: string;
	additions: number;
	deletions: number;
	isBinary: boolean;
	patch: string;
}

export interface AgentSessionChangePatch {
	sessionId: string;
	beforeCommit: string;
	afterCommit: string;
	patch: string;
	turns: AgentSessionChangeTurnPatch[];
}

export interface AgentSessionChangeScope {
	workstreamId: string;
}

export interface RestoreCheckpointResult {
	sessionId: string;
	removedRunCount: number;
	restoreSeq: number;
}

export interface CheckpointRestoreRedoResult {
	sessionId: string;
	restoreSeq: number;
	restoredRunIds: string[];
}
