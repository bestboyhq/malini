import {
	BRIDGE_COMMAND_NAMES,
	BRIDGE_CONTRACT_NAME,
	BRIDGE_HEARTBEAT_INTERVAL_MS,
	BRIDGE_MAX_FRAME_BYTES,
	BRIDGE_PROTOCOL_VERSION,
} from './generated/protocol-contract.js';
import {
	isAgentRunProfile,
	type AgentReasoningEffort,
	type AgentRunProfile,
} from './agent-profile.js';
import type { AgentQuestionAnswer, ApprovalDecision, ApprovalScope } from './interaction-types.js';
import { isOneOf, isRecord } from './type-guards.js';

export type AgentCommand =
	| StartSessionCommand
	| SendPromptCommand
	| CancelRunCommand
	| CloseSessionCommand
	| ApproveCommand
	| AnswerQuestionCommand
	| RefreshCapabilitiesCommand
	| RefreshMcpStatusCommand
	| SuggestTitleCommand;

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

export type ConversationHistoryMessage =
	| {
			readonly role: 'user';
			readonly content: string;
	  }
	| {
			readonly role: 'assistant';
			readonly content: string;
			readonly reasoningContent?: string;
	  };

const MAX_CONVERSATION_HISTORY_MESSAGES = 4_096;
const MAX_CONVERSATION_HISTORY_BYTES = 256 * 1_024;

export interface SendPromptCommand {
	readonly cmd: 'send_prompt';
	readonly id: string;
	readonly sessionId: string;
	readonly runId: string;
	readonly prompt: string;
	readonly profile?: AgentRunProfile;
	readonly resumeAt?: string;
	readonly freshConversation?: boolean;
}

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

export interface RefreshMcpStatusCommand {
	readonly cmd: 'refresh_mcp_status';
	readonly id: string;
	readonly sessionId: string;
	readonly runId: string;
}

export interface SuggestTitleCommand {
	readonly cmd: 'suggest_title';
	readonly id: string;
	readonly prompt: string;
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

export type BridgeControlFrame =
	| BridgeReadyFrame
	| BridgeCapabilitiesFrame
	| BridgeHeartbeatFrame
	| BridgeCommandAckFrame
	| BridgeProtocolErrorFrame
	| BridgeTitleFrame;

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
		case 'refresh_mcp_status':
			return validateRefreshMcpStatus(obj);
		case 'suggest_title':
			return validateSuggestTitle(obj);
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
	const parsedConversationHistory = validateConversationHistory(conversationHistory);
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
):
	| { readonly ok: true; readonly value?: ConversationHistoryMessage[] }
	| { readonly ok: false; readonly error: string } {
	if (value === undefined) return { ok: true };
	if (!Array.isArray(value)) {
		return {
			ok: false,
			error: 'start_session: conversationHistory, when present, must be an array',
		};
	}
	if (value.length > MAX_CONVERSATION_HISTORY_MESSAGES) {
		return {
			ok: false,
			error: `start_session: conversationHistory exceeds ${MAX_CONVERSATION_HISTORY_MESSAGES} messages`,
		};
	}
	let bytes = 0;
	const messages: ConversationHistoryMessage[] = [];
	for (const item of value) {
		if (!isRecord(item)) {
			return {
				ok: false,
				error: 'start_session: conversationHistory entries must be objects',
			};
		}
		const keys = Object.keys(item);
		if (keys.some((key) => key !== 'role' && key !== 'content' && key !== 'reasoningContent')) {
			return {
				ok: false,
				error:
					'start_session: conversationHistory entries may only contain role, content, and reasoningContent',
			};
		}
		const { role, content, reasoningContent } = item;
		if (role !== 'user' && role !== 'assistant') {
			return {
				ok: false,
				error: 'start_session: conversationHistory role must be user or assistant',
			};
		}
		if (typeof content !== 'string' || content.length === 0) {
			return {
				ok: false,
				error: 'start_session: conversationHistory content must be a non-empty string',
			};
		}
		if (reasoningContent !== undefined) {
			if (role !== 'assistant') {
				return {
					ok: false,
					error:
						'start_session: conversationHistory reasoningContent is only valid for assistant messages',
				};
			}
			if (typeof reasoningContent !== 'string' || reasoningContent.length === 0) {
				return {
					ok: false,
					error:
						'start_session: conversationHistory reasoningContent must be a non-empty string when present',
				};
			}
		}
		bytes +=
			Buffer.byteLength(content, 'utf8') +
			(typeof reasoningContent === 'string' ? Buffer.byteLength(reasoningContent, 'utf8') : 0);
		if (bytes > MAX_CONVERSATION_HISTORY_BYTES) {
			return {
				ok: false,
				error: `start_session: conversationHistory exceeds ${MAX_CONVERSATION_HISTORY_BYTES} UTF-8 bytes`,
			};
		}
		if (role === 'user') {
			messages.push({ role, content });
		} else {
			messages.push({
				role,
				content,
				...(typeof reasoningContent === 'string' ? { reasoningContent } : {}),
			});
		}
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
			'send_prompt: profile must contain effort (low|medium|high|xhigh|max), mode (agent|plan) and access (sandboxed|auto|full)',
			obj,
		);
	}
	if (resumeAt !== undefined && (typeof resumeAt !== 'string' || resumeAt.length === 0)) {
		return err('INVALID_PAYLOAD', 'send_prompt: resumeAt, when present, must be a string', obj);
	}
	if (freshConversation !== undefined && typeof freshConversation !== 'boolean') {
		return err('INVALID_PAYLOAD', 'send_prompt: freshConversation must be a boolean', obj);
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
		},
	};
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
		return err('INVALID_PAYLOAD', 'approve: scope must be "once", "session", or "workstream"', obj);
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
		},
	};
}

function isApprovalScope(value: unknown): value is ApprovalScope {
	return value === 'once' || value === 'session' || value === 'workstream';
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

function validateRefreshMcpStatus(obj: Record<string, unknown>): ParseResult {
	const id = commandId(obj, 'refresh_mcp_status');
	if (!id.ok) return id;
	const sessionId = obj.sessionId;
	const runId = obj.runId;
	if (typeof sessionId !== 'string' || sessionId.length === 0) {
		return err('INVALID_PAYLOAD', 'refresh_mcp_status: sessionId required (non-empty string)', obj);
	}
	if (typeof runId !== 'string' || runId.length === 0) {
		return err('INVALID_PAYLOAD', 'refresh_mcp_status: runId required (non-empty string)', obj);
	}
	return {
		ok: true,
		command: { cmd: 'refresh_mcp_status', id: id.value, sessionId, runId },
	};
}

function validateSuggestTitle(obj: Record<string, unknown>): ParseResult {
	const id = commandId(obj, 'suggest_title');
	if (!id.ok) return id;
	const prompt = obj.prompt;
	if (typeof prompt !== 'string' || prompt.trim().length === 0) {
		return err('INVALID_PAYLOAD', 'suggest_title: prompt required (non-empty string)', obj);
	}
	return { ok: true, command: { cmd: 'suggest_title', id: id.value, prompt } };
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
	};
}
