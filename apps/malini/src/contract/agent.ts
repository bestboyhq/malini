import type { SessionStatus } from './agent-state-machine';

export type AgentReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type AgentRunMode = 'agent' | 'plan';

export type AgentAccess = 'sandboxed' | 'auto' | 'full';

export type AgentReport = 'low' | 'medium' | 'high';

export type AgentTheme = 'light' | 'dark';

export const OPTIMIZE_CONTEXT_SETTING = 'chat.optimize-context';

export function optimizesContext(setting: string | null | undefined): boolean {
	return setting !== 'off';
}

export const STE_REPLIES_SETTING = 'chat.ste-replies';

export function writesSte(setting: string | null | undefined): boolean {
	return setting === 'on';
}

export const CONTEXT_WINDOW_SETTING = 'chat.context-window';

export const DEFAULT_CONTEXT_WINDOW = 280_000;

export const CONTEXT_WINDOW_RANGE = Object.freeze({ min: 100_000, max: 1_000_000, step: 10_000 });

export function contextWindowOf(setting: string | null | undefined): number {
	const tokens = Number.parseInt(setting ?? '', 10);
	if (Number.isNaN(tokens)) return DEFAULT_CONTEXT_WINDOW;
	const { min, max, step } = CONTEXT_WINDOW_RANGE;
	return Math.min(max, Math.max(min, Math.round(tokens / step) * step));
}

export interface AgentRunProfile {
	effort: AgentReasoningEffort;
	mode: AgentRunMode;
	access: AgentAccess;
	report?: AgentReport;
}

const AGENT_REASONING_EFFORTS: readonly AgentReasoningEffort[] = [
	'low',
	'medium',
	'high',
	'xhigh',
	'max',
];
const AGENT_RUN_MODES: readonly AgentRunMode[] = ['agent', 'plan'];
const AGENT_ACCESS_LEVELS: readonly AgentAccess[] = ['sandboxed', 'auto', 'full'];
const AGENT_REPORTS: readonly AgentReport[] = ['low', 'medium', 'high'];

function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
	return values.some((candidate) => candidate === value);
}

export function agentRunProfileOf(value: unknown): AgentRunProfile | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
	const effort: unknown = Reflect.get(value, 'effort');
	const mode: unknown = Reflect.get(value, 'mode');
	const access: unknown = Reflect.get(value, 'access') ?? 'auto';
	const report: unknown = Reflect.get(value, 'report');
	if (
		!oneOf(AGENT_REASONING_EFFORTS, effort) ||
		!oneOf(AGENT_RUN_MODES, mode) ||
		!oneOf(AGENT_ACCESS_LEVELS, access)
	) {
		return null;
	}
	if (report === undefined) return { effort, mode, access };
	return oneOf(AGENT_REPORTS, report) ? { effort, mode, access, report } : null;
}

export interface AgentCheckout {
	repository: string;
	branch: string;
	path: string;
}

export interface AgentLead {
	owner: string;
	repositories: AgentCheckout[];
	workstreams: AgentCheckout[];
	plan: string;
}

export interface AgentStarter {
	name: string;
	lead: boolean;
	plan: string | null;
}

export interface AgentLineage {
	lead: AgentLead | null;
	startedBy: AgentStarter | null;
	siblings: AgentCheckout[];
}

export interface AgentBoundary {
	hidden: string[];
	chatRecords: boolean;
	internet: boolean;
}

export type ProviderCapabilityState = 'ready' | 'needs_auth' | 'missing' | 'unknown';

export interface AgentModelInfo {
	id: string;
	label: string;
	description: string;
	efforts: AgentReasoningEffort[];
	family?: string;
}

export type ModelProviderKind = 'claude' | 'anthropic' | 'chatgpt';

export interface ProviderAccount {
	email: string | null;
	name: string | null;
	usageLimitReachedAt: string | null;
}

export type ProviderPlan = 'console' | 'go';

export interface AgentPlanLimit {
	label: string;
	usedPercent: number;
	resetsAt: string | null;
}

export interface AgentPlanUsage {
	observedAt: string;
	limits: readonly AgentPlanLimit[];
}

export interface ModelProviderRecord {
	id: string;
	name: string;
	kind: ModelProviderKind;
	baseUrl: string | null;
	models: AgentModelInfo[];
	keySaved: boolean;
	account: ProviderAccount | null;
	plan: ProviderPlan | null;
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

export type ChatGptSignInOutcome = 'signed-in' | 'cancelled';

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

export const RUN_FAILURE_KINDS = [
	'usage-limit',
	'rate-limit',
	'overloaded',
	'server-error',
	'network',
	'sign-in',
	'billing',
	'model',
	'request',
	'unknown',
] as const;

export type RunFailureKind = (typeof RUN_FAILURE_KINDS)[number];

export interface RunFailure {
	kind: RunFailureKind;
	resetsAt?: string;
	status?: number;
}

export interface AgentEventEnvelope {
	sessionId: string;
	runId: string;
	seq: number;
	event: Record<string, unknown>;
	emittedAt?: string;
}

export type LiveEventEnvelope = AgentEventEnvelope & { ephemeral?: true };

export type AgentSessionOrigin = 'user' | 'automation' | 'thread';

export interface AgentSessionSummary {
	id: string;
	workstreamId: string;
	displayName: string;
	model: string | null;
	provider: string | null;
	status: SessionStatus;
	startedAt: string;
	origin: AgentSessionOrigin;
	latestProfile: AgentRunProfile | null;
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

export const AGENT_APPROVAL_SCOPES = [
	'once',
	'session',
	'workstream',
	'repository',
	'everywhere',
] as const;

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
