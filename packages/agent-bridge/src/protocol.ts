import { isAbsolute } from 'node:path';
import {
	BRIDGE_COMMAND_NAMES,
	BRIDGE_CONTRACT_NAME,
	BRIDGE_HEARTBEAT_INTERVAL_MS,
	BRIDGE_MAX_FRAME_BYTES,
	BRIDGE_PLATFORM_TOOLS,
	BRIDGE_PROTOCOL_VERSION,
} from './generated/protocol-contract.js';
import {
	isAgentLineage,
	isAgentRunProfile,
	isAgentTheme,
	type AgentLineage,
	type AgentReasoningEffort,
	type AgentRunProfile,
	type AgentTheme,
} from './agent-profile.js';
import type { AgentQuestionAnswer, ApprovalDecision, ApprovalScope } from './interaction-types.js';
import { isOneOf, isRecord } from './type-guards.js';
import type { McpServerListing, McpServerReport } from './types.js';

export type AgentCommand =
	| StartSessionCommand
	| SendPromptCommand
	| CancelRunCommand
	| CloseSessionCommand
	| ApproveCommand
	| AnswerQuestionCommand
	| RefreshCapabilitiesCommand
	| RefreshSessionStatusCommand
	| McpServerCommand
	| WatchMcpServersCommand
	| SwitchMcpServerCommand
	| CancelMcpAuthorizationCommand
	| StopTaskCommand
	| SuggestTitleCommand
	| ChooseCommand
	| ListSkillsCommand
	| BrowserResultCommand
	| PlatformResultCommand
	| HistoryResultCommand;

export interface StartSessionCommand {
	readonly cmd: 'start_session';
	readonly id: string;
	readonly sessionId: string;
	readonly workstreamId: string;
	readonly model?: string;
	readonly providerSessionId?: string;
	readonly worktreePath?: string;
	readonly conversationHistory?: readonly ConversationHistoryMessage[];
}

export type ConversationHistoryMessage = {
	readonly role: 'user' | 'assistant';
	readonly content: string;
};

const MAX_CONVERSATION_HISTORY_MESSAGES = 4_096;
export const MAX_CONVERSATION_HISTORY_BYTES = 256 * 1_024;

export interface SendPromptCommand {
	readonly cmd: 'send_prompt';
	readonly id: string;
	readonly sessionId: string;
	readonly runId: string;
	readonly prompt: string;
	readonly profile?: AgentRunProfile;
	readonly resumeAt?: string;
	readonly freshConversation?: boolean;
	readonly skills?: readonly string[];
	readonly steer?: boolean;
	readonly theme?: AgentTheme;
	readonly lineage?: AgentLineage;
}

const MAX_SKILLS = 1_000;
const MAX_SKILL_NAME_CHARACTERS = 200;

export interface CancelRunCommand {
	readonly cmd: 'cancel_run';
	readonly id: string;
	readonly sessionId: string;
	readonly runId: string;
}

export interface CloseSessionCommand {
	readonly cmd: 'close_session';
	readonly id: string;
	readonly sessionId: string;
}

export interface ApproveCommand {
	readonly cmd: 'approve';
	readonly id: string;
	readonly sessionId: string;
	readonly runId: string;
	readonly approvalId: string;
	readonly decision: ApprovalDecision;
	readonly scope: ApprovalScope;
	readonly alwaysAllow?: boolean;
	readonly updatedInput?: Readonly<Record<string, unknown>>;
}

export interface AnswerQuestionCommand {
	readonly cmd: 'answer_question';
	readonly id: string;
	readonly sessionId: string;
	readonly runId: string;
	readonly questionId: string;
	readonly answers: readonly AgentQuestionAnswer[];
}

export interface RefreshCapabilitiesCommand {
	readonly cmd: 'refresh_capabilities';
	readonly id: string;
}

export interface RefreshSessionStatusCommand {
	readonly cmd: 'refresh_session_status';
	readonly id: string;
	readonly sessionId: string;
}

export type McpServerCommand = {
	readonly cmd: 'authorize_mcp_server' | 'reconnect_mcp_server';
	readonly id: string;
	readonly serverName: string;
} & ({ readonly sessionId: string } | { readonly cwd: string });

export interface WatchMcpServersCommand {
	readonly cmd: 'watch_mcp_servers';
	readonly id: string;
	readonly cwd: string;
	readonly restart?: true;
}

export interface SwitchMcpServerCommand {
	readonly cmd: 'switch_mcp_server';
	readonly id: string;
	readonly serverName: string;
	readonly on: boolean;
	readonly folders: readonly string[];
}

export interface CancelMcpAuthorizationCommand {
	readonly cmd: 'cancel_mcp_authorization';
	readonly id: string;
	readonly serverName: string;
}

export interface StopTaskCommand {
	readonly cmd: 'stop_task';
	readonly id: string;
	readonly sessionId: string;
	readonly runId: string;
	readonly taskId: string;
}

export interface SuggestTitleCommand {
	readonly cmd: 'suggest_title';
	readonly id: string;
	readonly prompt: string;
	readonly instructions: string;
	readonly model: string;
}

export interface ChooseCommand {
	readonly cmd: 'choose';
	readonly id: string;
	readonly prompt: string;
	readonly instructions: string;
	readonly model: string;
	readonly choices: number;
}

export const MIN_CHOICES = 2;

export const MAX_CHOICES = 20;

export interface ListSkillsCommand {
	readonly cmd: 'list_skills';
	readonly id: string;
	readonly cwd: string;
	readonly turnedOff?: TurnedOffSkills;
}

export interface TurnedOffSkills {
	readonly skills: readonly string[];
	readonly plugins: readonly string[];
}

export type BrowserRequest =
	| { readonly action: 'open'; readonly url: string }
	| { readonly action: 'screenshot' }
	| { readonly action: 'click'; readonly selector: string }
	| {
			readonly action: 'type';
			readonly selector: string;
			readonly text: string;
			readonly submit: boolean;
	  }
	| { readonly action: 'back' }
	| { readonly action: 'forward' }
	| { readonly action: 'reload' }
	| { readonly action: 'resize'; readonly width: number };

export interface BrowserResult {
	readonly ok: boolean;
	readonly text?: string;
	readonly imagePath?: string;
	readonly error?: string;
}

export interface BrowserResultCommand extends BrowserResult {
	readonly cmd: 'browser_result';
	readonly id: string;
	readonly sessionId: string;
	readonly requestId: string;
}

export type PlatformTool = (typeof BRIDGE_PLATFORM_TOOLS)[number];

export interface PlatformToolCall {
	readonly tool: PlatformTool;
	readonly input: Readonly<Record<string, unknown>>;
}

export interface PlatformRequest extends PlatformToolCall {
	readonly runId: string;
}

export interface PlatformResult {
	readonly ok: boolean;
	readonly text?: string;
	readonly error?: string;
}

export interface PlatformResultCommand extends PlatformResult {
	readonly cmd: 'platform_result';
	readonly id: string;
	readonly sessionId: string;
	readonly requestId: string;
}

export interface HistoryResult extends PlatformResult {
	readonly messages?: readonly ConversationHistoryMessage[];
}

export interface HistoryResultCommand extends HistoryResult {
	readonly cmd: 'history_result';
	readonly id: string;
	readonly sessionId: string;
	readonly requestId: string;
}

export type CommandName = AgentCommand['cmd'];

export const COMMAND_NAMES = BRIDGE_COMMAND_NAMES satisfies readonly CommandName[];

type MissingGeneratedCommand = Exclude<CommandName, (typeof BRIDGE_COMMAND_NAMES)[number]>;
type UnknownGeneratedCommand = Exclude<(typeof BRIDGE_COMMAND_NAMES)[number], CommandName>;
const COMMAND_CONTRACT_IS_EXHAUSTIVE: MissingGeneratedCommand extends never ? true : never = true;
const GENERATED_COMMANDS_ARE_KNOWN: UnknownGeneratedCommand extends never ? true : never = true;
void COMMAND_CONTRACT_IS_EXHAUSTIVE;
void GENERATED_COMMANDS_ARE_KNOWN;

export type ProviderCapabilityState = 'ready' | 'needs_auth' | 'missing' | 'unknown';

export interface AgentModelInfo {
	readonly id: string;
	readonly label: string;
	readonly description: string;
	readonly efforts: readonly AgentReasoningEffort[];
}

export interface AgentAccount {
	readonly email?: string;
	readonly plan?: string;
}

export interface ProviderCapability {
	readonly state: ProviderCapabilityState;
	readonly installed: boolean;
	readonly authenticated: boolean | null;
	readonly version: string | null;
	readonly account: AgentAccount | null;
	readonly models: readonly AgentModelInfo[];
	readonly defaultModel: string;
	readonly message: string;
}

export type AgentSkillSource = 'personal' | 'repository' | 'plugin' | 'claude-code' | 'other';

export interface AgentSkill {
	readonly name: string;
	readonly description: string;
	readonly source: AgentSkillSource;
	readonly tokens: number;
}

export interface BridgeReadyFrame {
	readonly type: 'bridge.ready';
	readonly contractName: typeof BRIDGE_CONTRACT_NAME;
	readonly protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
	readonly pid: number;
	readonly capabilities: readonly ProviderCapability[];
	readonly heartbeatIntervalMs: typeof BRIDGE_HEARTBEAT_INTERVAL_MS;
}

export interface BridgeCapabilitiesFrame {
	readonly type: 'bridge.capabilities';
	readonly protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
	readonly capabilities: readonly ProviderCapability[];
}

export interface BridgeHeartbeatFrame {
	readonly type: 'bridge.heartbeat';
	readonly protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
	readonly ts: number;
}

export interface BridgeCommandAckFrame {
	readonly type: 'bridge.command_ack';
	readonly protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
	readonly id: string;
	readonly accepted: boolean;
	readonly error?: string;
}

export interface BridgeProtocolErrorFrame {
	readonly type: 'bridge.protocol_error';
	readonly protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
	readonly id?: string;
	readonly runId?: string;
	readonly sessionId?: string;
	readonly code: ParseErrorCode | string;
	readonly message: string;
}

export interface BridgeTitleFrame {
	readonly type: 'bridge.title';
	readonly protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
	readonly id: string;
	readonly title: string;
}

export interface BridgeChoiceFrame {
	readonly type: 'bridge.choice';
	readonly protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
	readonly id: string;
	readonly pick: number;
}

export interface BridgeSkillsFrame {
	readonly type: 'bridge.skills';
	readonly protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
	readonly id: string;
	readonly skills: readonly AgentSkill[];
}

export interface BridgeMcpAuthorizationFrame {
	readonly type: 'bridge.mcp_authorization';
	readonly protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
	readonly id: string;
	readonly authUrl?: string;
}

export interface BridgeMcpServersFrame {
	readonly type: 'bridge.mcp_servers';
	readonly protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
	readonly cwd: string;
	readonly servers: readonly McpServerReport[];
	readonly settled: boolean;
	readonly error?: string;
}

export interface BridgeMcpSwitchedFrame {
	readonly type: 'bridge.mcp_switched';
	readonly protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
	readonly id: string;
	readonly folders: readonly string[];
}

export interface BridgeMcpServerFrame {
	readonly type: 'bridge.mcp_server';
	readonly protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
	readonly server: McpServerReport;
}

export type BridgeBrowserRequestFrame = {
	readonly type: 'bridge.browser_request';
	readonly protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
	readonly requestId: string;
	readonly sessionId: string;
} & BrowserRequest;

export type BridgePlatformRequestFrame = {
	readonly type: 'bridge.platform_request';
	readonly protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
	readonly requestId: string;
	readonly sessionId: string;
} & PlatformRequest;

export interface BridgeHistoryRequestFrame {
	readonly type: 'bridge.history_request';
	readonly protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
	readonly requestId: string;
	readonly sessionId: string;
}

export type BridgeControlFrame =
	| BridgeReadyFrame
	| BridgeCapabilitiesFrame
	| BridgeHeartbeatFrame
	| BridgeCommandAckFrame
	| BridgeProtocolErrorFrame
	| BridgeTitleFrame
	| BridgeChoiceFrame
	| BridgeSkillsFrame
	| BridgeMcpAuthorizationFrame
	| BridgeMcpServersFrame
	| BridgeMcpServerFrame
	| BridgeMcpSwitchedFrame
	| BridgeBrowserRequestFrame
	| BridgePlatformRequestFrame
	| BridgeHistoryRequestFrame;

export function bridgeReadyFrame(capabilities: readonly ProviderCapability[]): BridgeReadyFrame {
	return {
		type: 'bridge.ready',
		contractName: BRIDGE_CONTRACT_NAME,
		protocolVersion: BRIDGE_PROTOCOL_VERSION,
		pid: process.pid,
		capabilities,
		heartbeatIntervalMs: BRIDGE_HEARTBEAT_INTERVAL_MS,
	};
}

export function bridgeHeartbeatFrame(ts = Date.now()): BridgeHeartbeatFrame {
	return { type: 'bridge.heartbeat', protocolVersion: BRIDGE_PROTOCOL_VERSION, ts };
}

export function bridgeCapabilitiesFrame(
	capabilities: readonly ProviderCapability[],
): BridgeCapabilitiesFrame {
	return {
		type: 'bridge.capabilities',
		protocolVersion: BRIDGE_PROTOCOL_VERSION,
		capabilities,
	};
}

export function bridgeTitleFrame(id: string, title: string): BridgeTitleFrame {
	return { type: 'bridge.title', protocolVersion: BRIDGE_PROTOCOL_VERSION, id, title };
}

export function bridgeChoiceFrame(id: string, pick: number): BridgeChoiceFrame {
	return { type: 'bridge.choice', protocolVersion: BRIDGE_PROTOCOL_VERSION, id, pick };
}

export function bridgeSkillsFrame(id: string, skills: readonly AgentSkill[]): BridgeSkillsFrame {
	return { type: 'bridge.skills', protocolVersion: BRIDGE_PROTOCOL_VERSION, id, skills };
}

export function bridgeMcpAuthorizationFrame(
	id: string,
	authUrl: string | null,
): BridgeMcpAuthorizationFrame {
	return {
		type: 'bridge.mcp_authorization',
		protocolVersion: BRIDGE_PROTOCOL_VERSION,
		id,
		...(authUrl === null ? {} : { authUrl }),
	};
}

export function bridgeMcpServersFrame(
	cwd: string,
	{ servers, settled, error }: McpServerListing,
): BridgeMcpServersFrame {
	return {
		type: 'bridge.mcp_servers',
		protocolVersion: BRIDGE_PROTOCOL_VERSION,
		cwd,
		servers,
		settled,
		...(error === undefined ? {} : { error }),
	};
}

export function bridgeMcpSwitchedFrame(
	id: string,
	folders: readonly string[],
): BridgeMcpSwitchedFrame {
	return { type: 'bridge.mcp_switched', protocolVersion: BRIDGE_PROTOCOL_VERSION, id, folders };
}

export function bridgeMcpServerFrame(server: McpServerReport): BridgeMcpServerFrame {
	return { type: 'bridge.mcp_server', protocolVersion: BRIDGE_PROTOCOL_VERSION, server };
}

export function bridgeBrowserRequestFrame(
	requestId: string,
	sessionId: string,
	request: BrowserRequest,
): BridgeBrowserRequestFrame {
	return {
		type: 'bridge.browser_request',
		protocolVersion: BRIDGE_PROTOCOL_VERSION,
		requestId,
		sessionId,
		...request,
	};
}

export function bridgePlatformRequestFrame(
	requestId: string,
	sessionId: string,
	request: PlatformRequest,
): BridgePlatformRequestFrame {
	return {
		type: 'bridge.platform_request',
		protocolVersion: BRIDGE_PROTOCOL_VERSION,
		requestId,
		sessionId,
		...request,
	};
}

export function bridgeHistoryRequestFrame(
	requestId: string,
	sessionId: string,
): BridgeHistoryRequestFrame {
	return {
		type: 'bridge.history_request',
		protocolVersion: BRIDGE_PROTOCOL_VERSION,
		requestId,
		sessionId,
	};
}

export function bridgeCommandAckFrame(id: string, error?: string): BridgeCommandAckFrame {
	return {
		type: 'bridge.command_ack',
		protocolVersion: BRIDGE_PROTOCOL_VERSION,
		id,
		accepted: error === undefined,
		...(error !== undefined ? { error } : {}),
	};
}

export function bridgeProtocolErrorFrame(error: ParseError): BridgeProtocolErrorFrame {
	return {
		type: 'bridge.protocol_error',
		protocolVersion: BRIDGE_PROTOCOL_VERSION,
		...(error.id !== undefined ? { id: error.id } : {}),
		...(error.runId !== undefined ? { runId: error.runId } : {}),
		...(error.sessionId !== undefined ? { sessionId: error.sessionId } : {}),
		code: error.code,
		message: error.message,
	};
}

export type ParseErrorCode =
	'BAD_FRAME' | 'FRAME_TOO_LARGE' | 'UNKNOWN_COMMAND' | 'INVALID_PAYLOAD';

export interface ParseError {
	readonly ok: false;
	readonly code: ParseErrorCode;
	readonly message: string;
	readonly id?: string;
	readonly runId?: string;
	readonly sessionId?: string;
	readonly requestId?: string;
}

export interface ParseSuccess {
	readonly ok: true;
	readonly command: AgentCommand;
}

export type ParseResult = ParseSuccess | ParseError;

export function parseCommandLine(raw: string): ParseResult {
	if (Buffer.byteLength(raw, 'utf8') > BRIDGE_MAX_FRAME_BYTES) {
		return {
			ok: false,
			code: 'FRAME_TOO_LARGE',
			message: `frame exceeds ${BRIDGE_MAX_FRAME_BYTES} bytes`,
		};
	}
	if (raw.trim() === '') {
		return { ok: false, code: 'BAD_FRAME', message: 'empty line' };
	}
	let unknown: unknown;
	try {
		unknown = JSON.parse(raw);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, code: 'BAD_FRAME', message: `malformed JSON: ${msg}` };
	}
	if (!isRecord(unknown)) {
		return { ok: false, code: 'BAD_FRAME', message: 'top-level value is not an object' };
	}
	const obj = unknown;
	const cmd = obj.cmd;
	if (typeof cmd !== 'string') {
		return err('UNKNOWN_COMMAND', '"cmd" field missing or not a string', obj);
	}
	if (!isCommandName(cmd)) {
		return err('UNKNOWN_COMMAND', `unknown command: ${cmd}`, obj);
	}
	switch (cmd) {
		case 'start_session':
			return validateStartSession(obj);
		case 'send_prompt':
			return validateSendPrompt(obj);
		case 'cancel_run':
			return validateCancelRun(obj);
		case 'close_session':
			return validateCloseSession(obj);
		case 'approve':
			return validateApprove(obj);
		case 'answer_question':
			return validateAnswerQuestion(obj);
		case 'refresh_capabilities':
			return validateRefreshCapabilities(obj);
		case 'refresh_session_status':
			return validateRefreshSessionStatus(obj);
		case 'authorize_mcp_server':
		case 'reconnect_mcp_server':
			return validateMcpServerCommand(cmd, obj);
		case 'watch_mcp_servers':
			return validateWatchMcpServers(obj);
		case 'switch_mcp_server':
			return validateSwitchMcpServer(obj);
		case 'cancel_mcp_authorization':
			return validateCancelMcpAuthorization(obj);
		case 'stop_task':
			return validateStopTask(obj);
		case 'suggest_title':
			return validateSuggestTitle(obj);
		case 'choose':
			return validateChoose(obj);
		case 'list_skills':
			return validateListSkills(obj);
		case 'browser_result':
			return validateBrowserResult(obj);
		case 'platform_result':
			return validatePlatformResult(obj);
		case 'history_result':
			return validateHistoryResult(obj);
	}
}

function isCommandName(value: string): value is CommandName {
	return isOneOf(COMMAND_NAMES, value);
}

function validateStartSession(obj: Record<string, unknown>): ParseResult {
	const id = commandId(obj, 'start_session');
	if (!id.ok) return id;
	const sessionId = obj.sessionId;
	const workstreamId = obj.workstreamId;
	const worktreePath = obj.worktreePath;
	const providerSessionId = obj.providerSessionId;
	const conversationHistory = obj.conversationHistory;
	if (typeof sessionId !== 'string' || sessionId.length === 0) {
		return err('INVALID_PAYLOAD', 'start_session: sessionId required (non-empty string)', obj);
	}
	if (typeof workstreamId !== 'string' || workstreamId.length === 0) {
		return err('INVALID_PAYLOAD', 'start_session: workstreamId required (non-empty string)', obj);
	}
	if (obj.model !== undefined && typeof obj.model !== 'string') {
		return err('INVALID_PAYLOAD', 'start_session: model, when present, must be a string', obj);
	}
	if (providerSessionId !== undefined && typeof providerSessionId !== 'string') {
		return err(
			'INVALID_PAYLOAD',
			'start_session: providerSessionId, when present, must be a string',
			obj,
		);
	}
	if (worktreePath !== undefined && typeof worktreePath !== 'string') {
		return err(
			'INVALID_PAYLOAD',
			'start_session: worktreePath, when present, must be a string',
			obj,
		);
	}
	const parsedConversationHistory = validateConversationHistory(
		conversationHistory,
		'start_session: conversationHistory',
	);
	if (!parsedConversationHistory.ok) {
		return err('INVALID_PAYLOAD', parsedConversationHistory.error, obj);
	}
	const cmd: StartSessionCommand = {
		cmd: 'start_session',
		id: id.value,
		sessionId,
		workstreamId,
		...(obj.model !== undefined ? { model: obj.model } : {}),
		...(providerSessionId !== undefined ? { providerSessionId } : {}),
		...(worktreePath !== undefined ? { worktreePath } : {}),
		...(parsedConversationHistory.value !== undefined
			? { conversationHistory: parsedConversationHistory.value }
			: {}),
	};
	return { ok: true, command: cmd };
}

function validateConversationHistory(
	value: unknown,
	field: string,
):
	| { readonly ok: true; readonly value?: ConversationHistoryMessage[] }
	| { readonly ok: false; readonly error: string } {
	if (value === undefined) return { ok: true };
	if (!Array.isArray(value)) {
		return {
			ok: false,
			error: `${field}, when present, must be an array`,
		};
	}
	if (value.length > MAX_CONVERSATION_HISTORY_MESSAGES) {
		return {
			ok: false,
			error: `${field} exceeds ${MAX_CONVERSATION_HISTORY_MESSAGES} messages`,
		};
	}
	let bytes = 0;
	const messages: ConversationHistoryMessage[] = [];
	for (const item of value) {
		if (!isRecord(item)) {
			return {
				ok: false,
				error: `${field} entries must be objects`,
			};
		}
		const keys = Object.keys(item);
		if (keys.some((key) => key !== 'role' && key !== 'content')) {
			return {
				ok: false,
				error: `${field} entries may only contain role and content`,
			};
		}
		const { role, content } = item;
		if (role !== 'user' && role !== 'assistant') {
			return {
				ok: false,
				error: `${field} role must be user or assistant`,
			};
		}
		if (typeof content !== 'string' || content.length === 0) {
			return {
				ok: false,
				error: `${field} content must be a non-empty string`,
			};
		}
		bytes += Buffer.byteLength(content, 'utf8');
		if (bytes > MAX_CONVERSATION_HISTORY_BYTES) {
			return {
				ok: false,
				error: `${field} exceeds ${MAX_CONVERSATION_HISTORY_BYTES} UTF-8 bytes`,
			};
		}
		messages.push({ role, content });
	}
	return { ok: true, value: messages };
}

function validateSendPrompt(obj: Record<string, unknown>): ParseResult {
	const id = commandId(obj, 'send_prompt');
	if (!id.ok) return id;
	const sessionId = obj.sessionId;
	const runId = obj.runId;
	const prompt = obj.prompt;
	const profile = obj.profile;
	const resumeAt = obj.resumeAt;
	const freshConversation = obj.freshConversation;
	const skills = obj.skills;
	const steer = obj.steer;
	const theme = obj.theme;
	const lineage = obj.lineage;
	if (typeof sessionId !== 'string' || sessionId.length === 0) {
		return err('INVALID_PAYLOAD', 'send_prompt: sessionId required (non-empty string)', obj);
	}
	if (typeof runId !== 'string' || runId.length === 0) {
		return err('INVALID_PAYLOAD', 'send_prompt: runId required (non-empty string)', obj);
	}
	if (typeof prompt !== 'string') {
		return err('INVALID_PAYLOAD', 'send_prompt: prompt required (string)', obj);
	}
	if (profile !== undefined && !isAgentRunProfile(profile)) {
		return err(
			'INVALID_PAYLOAD',
			'send_prompt: profile must contain effort (low|medium|high|xhigh|max), mode (agent|plan), access (sandboxed|auto|full) and, when present, report (low|medium|high)',
			obj,
		);
	}
	if (resumeAt !== undefined && (typeof resumeAt !== 'string' || resumeAt.length === 0)) {
		return err('INVALID_PAYLOAD', 'send_prompt: resumeAt, when present, must be a string', obj);
	}
	if (freshConversation !== undefined && typeof freshConversation !== 'boolean') {
		return err('INVALID_PAYLOAD', 'send_prompt: freshConversation must be a boolean', obj);
	}
	if (steer !== undefined && typeof steer !== 'boolean') {
		return err('INVALID_PAYLOAD', 'send_prompt: steer must be a boolean', obj);
	}
	if (theme !== undefined && !isAgentTheme(theme)) {
		return err('INVALID_PAYLOAD', 'send_prompt: theme, when present, must be light or dark', obj);
	}
	if (lineage !== undefined && !isAgentLineage(lineage)) {
		return err(
			'INVALID_PAYLOAD',
			'send_prompt: lineage, when present, must hold lead, startedBy and siblings',
			obj,
		);
	}
	if (skills !== undefined && !isSkillList(skills)) {
		return err(
			'INVALID_PAYLOAD',
			`send_prompt: skills, when present, must be at most ${MAX_SKILLS} skill names`,
			obj,
		);
	}
	return {
		ok: true,
		command: {
			cmd: 'send_prompt',
			id: id.value,
			sessionId,
			runId,
			prompt,
			...(profile !== undefined ? { profile } : {}),
			...(resumeAt !== undefined ? { resumeAt } : {}),
			...(freshConversation === true ? { freshConversation } : {}),
			...(skills !== undefined ? { skills } : {}),
			...(steer === true ? { steer } : {}),
			...(theme !== undefined ? { theme } : {}),
			...(lineage !== undefined ? { lineage } : {}),
		},
	};
}

function isSkillList(value: unknown): value is string[] {
	return (
		Array.isArray(value) &&
		value.length <= MAX_SKILLS &&
		value.every(
			(name) =>
				typeof name === 'string' &&
				name.trim().length > 0 &&
				name.length <= MAX_SKILL_NAME_CHARACTERS,
		)
	);
}

function validateCancelRun(obj: Record<string, unknown>): ParseResult {
	const id = commandId(obj, 'cancel_run');
	if (!id.ok) return id;
	const sessionId = obj.sessionId;
	const runId = obj.runId;
	if (typeof sessionId !== 'string' || sessionId.length === 0) {
		return err('INVALID_PAYLOAD', 'cancel_run: sessionId required (non-empty string)', obj);
	}
	if (typeof runId !== 'string' || runId.length === 0) {
		return err('INVALID_PAYLOAD', 'cancel_run: runId required (non-empty string)', obj);
	}
	return { ok: true, command: { cmd: 'cancel_run', id: id.value, sessionId, runId } };
}

function validateCloseSession(obj: Record<string, unknown>): ParseResult {
	const id = commandId(obj, 'close_session');
	if (!id.ok) return id;
	const sessionId = obj.sessionId;
	if (typeof sessionId !== 'string' || sessionId.length === 0) {
		return err('INVALID_PAYLOAD', 'close_session: sessionId required (non-empty string)', obj);
	}
	return { ok: true, command: { cmd: 'close_session', id: id.value, sessionId } };
}

function validateApprove(obj: Record<string, unknown>): ParseResult {
	const id = commandId(obj, 'approve');
	if (!id.ok) return id;
	const sessionId = obj.sessionId;
	const runId = obj.runId;
	const approvalId = obj.approvalId;
	const decision = obj.decision;
	const scope = obj.scope ?? 'once';
	const alwaysAllow = obj.alwaysAllow;
	if (typeof sessionId !== 'string' || sessionId.length === 0) {
		return err('INVALID_PAYLOAD', 'approve: sessionId required (non-empty string)', obj);
	}
	if (typeof runId !== 'string' || runId.length === 0) {
		return err('INVALID_PAYLOAD', 'approve: runId required (non-empty string)', obj);
	}
	if (typeof approvalId !== 'string' || approvalId.length === 0) {
		return err('INVALID_PAYLOAD', 'approve: approvalId required (non-empty string)', obj);
	}
	if (decision !== 'allow' && decision !== 'approve' && decision !== 'deny') {
		return err('INVALID_PAYLOAD', 'approve: decision must be "allow" or "deny"', obj);
	}
	if (!isApprovalScope(scope)) {
		return err(
			'INVALID_PAYLOAD',
			'approve: scope must be "once", "session", "workstream", or "everywhere"',
			obj,
		);
	}
	const updatedInput = obj.updatedInput;
	if (updatedInput !== undefined && (!isRecord(updatedInput) || decision === 'deny')) {
		return err('INVALID_PAYLOAD', 'approve: updatedInput must be an object on an allow', obj);
	}
	if (alwaysAllow !== undefined && typeof alwaysAllow !== 'boolean') {
		return err('INVALID_PAYLOAD', 'approve: alwaysAllow must be a boolean', obj);
	}
	return {
		ok: true,
		command: {
			cmd: 'approve',
			id: id.value,
			sessionId,
			runId,
			approvalId,
			decision: decision === 'approve' ? 'allow' : decision,
			scope,
			...(alwaysAllow === true ? { alwaysAllow } : {}),
			...(updatedInput === undefined ? {} : { updatedInput }),
		},
	};
}

function isApprovalScope(value: unknown): value is ApprovalScope {
	return (
		typeof value === 'string' && isOneOf(['once', 'session', 'workstream', 'everywhere'], value)
	);
}

function validateAnswerQuestion(obj: Record<string, unknown>): ParseResult {
	const id = commandId(obj, 'answer_question');
	if (!id.ok) return id;
	const sessionId = obj.sessionId;
	const runId = obj.runId;
	const questionId = obj.questionId;
	if (typeof sessionId !== 'string' || sessionId.length === 0) {
		return err('INVALID_PAYLOAD', 'answer_question: sessionId required (non-empty string)', obj);
	}
	if (typeof runId !== 'string' || runId.length === 0) {
		return err('INVALID_PAYLOAD', 'answer_question: runId required (non-empty string)', obj);
	}
	if (typeof questionId !== 'string' || questionId.length === 0) {
		return err('INVALID_PAYLOAD', 'answer_question: questionId required (non-empty string)', obj);
	}
	const answers = parseQuestionAnswers(obj.answers);
	if (!answers) {
		return err(
			'INVALID_PAYLOAD',
			'answer_question: answers must be a non-empty array of unique { questionId, values: string[] } objects',
			obj,
		);
	}
	return {
		ok: true,
		command: {
			cmd: 'answer_question',
			id: id.value,
			sessionId,
			runId,
			questionId,
			answers,
		},
	};
}

function parseQuestionAnswers(value: unknown): AgentQuestionAnswer[] | null {
	if (!Array.isArray(value) || value.length === 0) return null;
	const answers: AgentQuestionAnswer[] = [];
	const questionIds = new Set<string>();
	for (const entry of value) {
		if (!isRecord(entry)) return null;
		const answer = entry;
		if (
			typeof answer.questionId !== 'string' ||
			answer.questionId.length === 0 ||
			questionIds.has(answer.questionId) ||
			!Array.isArray(answer.values) ||
			answer.values.some((item) => typeof item !== 'string')
		) {
			return null;
		}
		questionIds.add(answer.questionId);
		answers.push({ questionId: answer.questionId, values: answer.values as string[] });
	}
	return answers;
}

function validateRefreshCapabilities(obj: Record<string, unknown>): ParseResult {
	const id = commandId(obj, 'refresh_capabilities');
	if (!id.ok) return id;
	return { ok: true, command: { cmd: 'refresh_capabilities', id: id.value } };
}

function validateRefreshSessionStatus(obj: Record<string, unknown>): ParseResult {
	const id = commandId(obj, 'refresh_session_status');
	if (!id.ok) return id;
	const sessionId = obj.sessionId;
	if (typeof sessionId !== 'string' || sessionId.length === 0) {
		return err(
			'INVALID_PAYLOAD',
			'refresh_session_status: sessionId required (non-empty string)',
			obj,
		);
	}
	return { ok: true, command: { cmd: 'refresh_session_status', id: id.value, sessionId } };
}

function validateMcpServerCommand(
	cmd: McpServerCommand['cmd'],
	obj: Record<string, unknown>,
): ParseResult {
	const id = commandId(obj, cmd);
	if (!id.ok) return id;
	const { sessionId, cwd, serverName } = obj;
	if (typeof serverName !== 'string' || serverName.length === 0) {
		return err('INVALID_PAYLOAD', `${cmd}: serverName required (non-empty string)`, obj);
	}
	if (typeof sessionId === 'string' && sessionId.length > 0 && cwd === undefined) {
		return { ok: true, command: { cmd, id: id.value, sessionId, serverName } };
	}
	if (typeof cwd === 'string' && isAbsolute(cwd) && sessionId === undefined) {
		return { ok: true, command: { cmd, id: id.value, cwd, serverName } };
	}
	return err(
		'INVALID_PAYLOAD',
		`${cmd}: exactly one of sessionId (non-empty string) or cwd (absolute path) required`,
		obj,
	);
}

function validateWatchMcpServers(obj: Record<string, unknown>): ParseResult {
	const id = commandId(obj, 'watch_mcp_servers');
	if (!id.ok) return id;
	const { cwd, restart } = obj;
	if (typeof cwd !== 'string' || !isAbsolute(cwd)) {
		return err('INVALID_PAYLOAD', 'watch_mcp_servers: cwd required (absolute path)', obj);
	}
	if (restart !== undefined && restart !== true) {
		return err('INVALID_PAYLOAD', 'watch_mcp_servers: restart must be true when present', obj);
	}
	return {
		ok: true,
		command: { cmd: 'watch_mcp_servers', id: id.value, cwd, ...(restart ? { restart } : {}) },
	};
}

function validateSwitchMcpServer(obj: Record<string, unknown>): ParseResult {
	const id = commandId(obj, 'switch_mcp_server');
	if (!id.ok) return id;
	const { serverName, on, folders } = obj;
	if (typeof serverName !== 'string' || serverName.length === 0) {
		return err('INVALID_PAYLOAD', 'switch_mcp_server: serverName required (non-empty string)', obj);
	}
	if (typeof on !== 'boolean') {
		return err('INVALID_PAYLOAD', 'switch_mcp_server: on required (boolean)', obj);
	}
	if (
		!Array.isArray(folders) ||
		!folders.every((folder) => typeof folder === 'string' && isAbsolute(folder))
	) {
		return err('INVALID_PAYLOAD', 'switch_mcp_server: folders required (absolute paths)', obj);
	}
	return {
		ok: true,
		command: { cmd: 'switch_mcp_server', id: id.value, serverName, on, folders },
	};
}

function validateCancelMcpAuthorization(obj: Record<string, unknown>): ParseResult {
	const id = commandId(obj, 'cancel_mcp_authorization');
	if (!id.ok) return id;
	const serverName = obj.serverName;
	if (typeof serverName !== 'string' || serverName.length === 0) {
		return err(
			'INVALID_PAYLOAD',
			'cancel_mcp_authorization: serverName required (non-empty string)',
			obj,
		);
	}
	return { ok: true, command: { cmd: 'cancel_mcp_authorization', id: id.value, serverName } };
}

function validateStopTask(obj: Record<string, unknown>): ParseResult {
	const id = commandId(obj, 'stop_task');
	if (!id.ok) return id;
	const { sessionId, runId, taskId } = obj;
	if (typeof sessionId !== 'string' || sessionId.length === 0) {
		return err('INVALID_PAYLOAD', 'stop_task: sessionId required (non-empty string)', obj);
	}
	if (typeof runId !== 'string' || runId.length === 0) {
		return err('INVALID_PAYLOAD', 'stop_task: runId required (non-empty string)', obj);
	}
	if (typeof taskId !== 'string' || taskId.length === 0) {
		return err('INVALID_PAYLOAD', 'stop_task: taskId required (non-empty string)', obj);
	}
	return { ok: true, command: { cmd: 'stop_task', id: id.value, sessionId, runId, taskId } };
}

function validateSuggestTitle(obj: Record<string, unknown>): ParseResult {
	const id = commandId(obj, 'suggest_title');
	if (!id.ok) return id;
	const prompt = obj.prompt;
	if (typeof prompt !== 'string' || prompt.trim().length === 0) {
		return err('INVALID_PAYLOAD', 'suggest_title: prompt required (non-empty string)', obj);
	}
	const instructions = obj.instructions;
	if (typeof instructions !== 'string' || instructions.trim().length === 0) {
		return err('INVALID_PAYLOAD', 'suggest_title: instructions required (non-empty string)', obj);
	}
	const model = obj.model;
	if (typeof model !== 'string' || model.trim().length === 0) {
		return err('INVALID_PAYLOAD', 'suggest_title: model required (non-empty string)', obj);
	}
	return {
		ok: true,
		command: { cmd: 'suggest_title', id: id.value, prompt, instructions, model },
	};
}

function validateChoose(obj: Record<string, unknown>): ParseResult {
	const id = commandId(obj, 'choose');
	if (!id.ok) return id;
	const { prompt, instructions, model, choices } = obj;
	if (typeof prompt !== 'string' || prompt.trim().length === 0) {
		return err('INVALID_PAYLOAD', 'choose: prompt required (non-empty string)', obj);
	}
	if (typeof instructions !== 'string' || instructions.trim().length === 0) {
		return err('INVALID_PAYLOAD', 'choose: instructions required (non-empty string)', obj);
	}
	if (typeof model !== 'string' || model.trim().length === 0) {
		return err('INVALID_PAYLOAD', 'choose: model required (non-empty string)', obj);
	}
	if (
		typeof choices !== 'number' ||
		!Number.isSafeInteger(choices) ||
		choices < MIN_CHOICES ||
		choices > MAX_CHOICES
	) {
		return err(
			'INVALID_PAYLOAD',
			`choose: choices required (an integer from ${MIN_CHOICES} to ${MAX_CHOICES})`,
			obj,
		);
	}
	return {
		ok: true,
		command: { cmd: 'choose', id: id.value, prompt, instructions, model, choices },
	};
}

function validateListSkills(obj: Record<string, unknown>): ParseResult {
	const id = commandId(obj, 'list_skills');
	if (!id.ok) return id;
	const cwd = obj.cwd;
	if (typeof cwd !== 'string' || !isAbsolute(cwd)) {
		return err('INVALID_PAYLOAD', 'list_skills: cwd required (absolute path)', obj);
	}
	const turnedOff = obj.turnedOff;
	if (turnedOff !== undefined && !isTurnedOffSkills(turnedOff)) {
		return err(
			'INVALID_PAYLOAD',
			`list_skills: turnedOff, when present, must hold at most ${MAX_SKILLS} skill names and ${MAX_SKILLS} plugin ids`,
			obj,
		);
	}
	return {
		ok: true,
		command: {
			cmd: 'list_skills',
			id: id.value,
			cwd,
			...(turnedOff !== undefined
				? { turnedOff: { skills: turnedOff.skills, plugins: turnedOff.plugins } }
				: {}),
		},
	};
}

function isTurnedOffSkills(value: unknown): value is TurnedOffSkills {
	return isRecord(value) && isSkillList(value.skills) && isSkillList(value.plugins);
}

function validateBrowserResult(obj: Record<string, unknown>): ParseResult {
	const answer = validateAnswer(obj, 'browser_result');
	if (!answer.ok) return answer;
	const { imagePath } = obj;
	if (imagePath !== undefined && (typeof imagePath !== 'string' || !isAbsolute(imagePath))) {
		return err(
			'INVALID_PAYLOAD',
			'browser_result: imagePath, when present, must be an absolute path',
			obj,
		);
	}
	return {
		ok: true,
		command: {
			cmd: 'browser_result',
			...answer.value,
			...(imagePath !== undefined ? { imagePath } : {}),
		},
	};
}

function validatePlatformResult(obj: Record<string, unknown>): ParseResult {
	const answer = validateAnswer(obj, 'platform_result');
	return answer.ok ? { ok: true, command: { cmd: 'platform_result', ...answer.value } } : answer;
}

function validateHistoryResult(obj: Record<string, unknown>): ParseResult {
	const answer = validateAnswer(obj, 'history_result');
	if (!answer.ok) return answer;
	const messages = validateConversationHistory(obj.messages, 'history_result: messages');
	if (!messages.ok) return err('INVALID_PAYLOAD', messages.error, obj);
	return {
		ok: true,
		command: {
			cmd: 'history_result',
			...answer.value,
			...(messages.value !== undefined ? { messages: messages.value } : {}),
		},
	};
}

function validateAnswer(
	obj: Record<string, unknown>,
	cmd: 'browser_result' | 'platform_result' | 'history_result',
): { readonly ok: true; readonly value: Omit<PlatformResultCommand, 'cmd'> } | ParseError {
	const id = commandId(obj, cmd);
	if (!id.ok) return id;
	const { sessionId, requestId, ok, text, error } = obj;
	if (typeof sessionId !== 'string' || sessionId.length === 0) {
		return err('INVALID_PAYLOAD', `${cmd}: sessionId required (non-empty string)`, obj);
	}
	if (typeof requestId !== 'string' || requestId.length === 0) {
		return err('INVALID_PAYLOAD', `${cmd}: requestId required (non-empty string)`, obj);
	}
	if (typeof ok !== 'boolean') {
		return err('INVALID_PAYLOAD', `${cmd}: ok required (boolean)`, obj);
	}
	if (text !== undefined && typeof text !== 'string') {
		return err('INVALID_PAYLOAD', `${cmd}: text, when present, must be a string`, obj);
	}
	if (error !== undefined && typeof error !== 'string') {
		return err('INVALID_PAYLOAD', `${cmd}: error, when present, must be a string`, obj);
	}
	return {
		ok: true,
		value: {
			id: id.value,
			sessionId,
			requestId,
			ok,
			...(text !== undefined ? { text } : {}),
			...(error !== undefined ? { error } : {}),
		},
	};
}

function commandId(
	obj: Record<string, unknown>,
	command: CommandName,
): { readonly ok: true; readonly value: string } | ParseError {
	if (typeof obj.id !== 'string' || obj.id.length === 0) {
		return err('INVALID_PAYLOAD', `${command}: id required (non-empty string)`, obj);
	}
	return { ok: true, value: obj.id };
}

function err(code: ParseErrorCode, message: string, obj?: Record<string, unknown>): ParseError {
	return {
		ok: false,
		code,
		message,
		...(typeof obj?.id === 'string' ? { id: obj.id } : {}),
		...(typeof obj?.runId === 'string' ? { runId: obj.runId } : {}),
		...(typeof obj?.sessionId === 'string' ? { sessionId: obj.sessionId } : {}),
		...(typeof obj?.requestId === 'string' ? { requestId: obj.requestId } : {}),
	};
}
