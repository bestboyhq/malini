import type { SessionStatus } from './agent-state-machine';

export type AgentReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type AgentRunMode = 'agent' | 'plan';

export type AgentAccess = 'sandboxed' | 'auto' | 'full';

export type AgentReport = 'low' | 'medium' | 'high';

export type AgentTheme = 'light' | 'dark';

export interface AgentRunProfile {
	effort: AgentReasoningEffort;
	mode: AgentRunMode;
	access: AgentAccess;
	report?: AgentReport;
}

export interface AgentCheckout {
	repository: string;
	branch: string;
	path: string;
}

export interface AgentLineage {
	lead: { owner: string | null; repositories: AgentCheckout[] } | null;
	startedBy: { name: string; lead: boolean } | null;
	siblings: AgentCheckout[];
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

export const CLAUDE_INSTALL_COMMAND = 'curl -fsSL https://claude.ai/install.sh | bash';

export type ClaudeSignInOutcome = 'signed-in' | 'cancelled';

export type ClaudeAccountSwitchOutcome = 'switched' | 'sign-in-needed';

export const AGENT_BACKGROUND_TASK_KINDS = ['command', 'agent', 'task'] as const;

export type AgentBackgroundTaskKind = (typeof AGENT_BACKGROUND_TASK_KINDS)[number];

export interface AgentBackgroundTask {
	taskId: string;
	kind: AgentBackgroundTaskKind;
	description: string;
	startedAt: number;
	toolCallId?: string;
	detail?: string;
}

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

export type AgentSessionOrigin = 'user' | 'job';

export interface AgentSessionSummary {
	id: string;
	workstreamId: string;
	displayName: string;
	model: string | null;
	status: SessionStatus;
	startedAt: string;
	origin: AgentSessionOrigin;
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
	source?: string;
}

export type AgentApprovalDecision = 'allow' | 'deny';

export const AGENT_APPROVAL_SCOPES = ['once', 'session', 'workstream', 'everywhere'] as const;

export type AgentApprovalScope = (typeof AGENT_APPROVAL_SCOPES)[number];

export function isAgentApprovalScope(value: unknown): value is AgentApprovalScope {
	return AGENT_APPROVAL_SCOPES.some((scope) => scope === value);
}

export interface AgentApprovalDecisionResult {
	readonly decision: AgentApprovalDecision;
	readonly scope: AgentApprovalScope;
	readonly remembered: boolean;
	readonly ruleId?: string;
}

export const MAX_ATTACHMENT_FILE_MB = 100;
export const MAX_ATTACHMENT_FILE_BYTES = MAX_ATTACHMENT_FILE_MB * 1024 * 1024;

export interface StagedAgentAttachment {
	id: string;
	displayName: string;
	relativePath: string;
	mediaType: string;
	size: number;
	sha256: string;
}

export type AdoptedAgentAttachment =
	{ sourceId: string; attachment: StagedAgentAttachment } | { sourceId: string; error: string };

export interface StagedAgentAttachmentBytes {
	mediaType: string;
	data: Uint8Array<ArrayBuffer>;
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
