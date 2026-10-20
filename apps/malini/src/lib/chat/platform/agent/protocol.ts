import {
	BRIDGE_COMMAND_ACK_TIMEOUT_MS,
	BRIDGE_CONTRACT_NAME,
	BRIDGE_EVENT_TYPES,
	BRIDGE_HEARTBEAT_INTERVAL_MS,
	BRIDGE_PLATFORM_TOOLS,
	BRIDGE_PROTOCOL_VERSION,
} from '$contract/protocol-contract.generated';
import {
	AGENT_BACKGROUND_TASK_KINDS,
	type AgentAccount,
	type AgentBackgroundTask,
	type AgentBackgroundTaskKind,
	type AgentModelInfo,
	type AgentQuestionAnswer,
	type AgentReasoningEffort,
	type AgentRunMode,
	type AgentRunProfile,
	type ProviderCapability,
	type ProviderCapabilityState,
} from '$contract/agent';
import type { SkillRecord, SkillSource, TurnedOffSkills } from '$contract/skills';

export type {
	AgentQuestionAnswer,
	AgentReasoningEffort,
	AgentRunMode,
	AgentRunProfile,
	ProviderCapability,
	ProviderCapabilityState,
};

export {
	BRIDGE_COMMAND_ACK_TIMEOUT_MS,
	BRIDGE_CONTRACT_NAME,
	BRIDGE_HEARTBEAT_INTERVAL_MS,
	BRIDGE_HEARTBEAT_TIMEOUT_MS,
	BRIDGE_MAX_DIAGNOSTIC_BYTES,
	BRIDGE_MAX_FRAME_BYTES,
	BRIDGE_PROTOCOL_VERSION,
	BRIDGE_READY_TIMEOUT_MS,
} from '$contract/protocol-contract.generated';

export const BRIDGE_START_SESSION_ACK_TIMEOUT_MS = 30_000;
export const BRIDGE_SUGGEST_TITLE_ACK_TIMEOUT_MS = 20_000;
export const BRIDGE_LIST_SKILLS_ACK_TIMEOUT_MS = 20_000;

export interface AgentConversationMessage {
	role: 'user' | 'assistant';
	content: string;
}

export interface AgentQuestionOption {
	label: string;
	description?: string;
}

export interface AgentQuestion {
	id: string;
	prompt: string;
	header?: string;
	options: AgentQuestionOption[];
	multiSelect: boolean;
	allowFreeText: boolean;
}

export interface AgentMcpServerStatus {
	name: string;
	status: string;
	error?: string;
}

export type BridgeCommand =
	| {
			cmd: 'start_session';
			id: string;
			sessionId: string;
			workstreamId: string;
			model?: string;
			providerSessionId?: string;
			worktreePath?: string;
			conversationHistory?: AgentConversationMessage[];
	  }
	| {
			cmd: 'send_prompt';
			id: string;
			sessionId: string;
			runId: string;
			prompt: string;
			profile?: AgentRunProfile;
			resumeAt?: string;
			freshConversation?: true;
			skills?: readonly string[];
			steer?: true;
	  }
	| { cmd: 'cancel_run'; id: string; sessionId: string; runId: string }
	| { cmd: 'close_session'; id: string; sessionId: string }
	| {
			cmd: 'approve';
			id: string;
			sessionId: string;
			runId: string;
			approvalId: string;
			decision: string;
			scope: string;
	  }
	| {
			cmd: 'answer_question';
			id: string;
			sessionId: string;
			runId: string;
			questionId: string;
			answers: AgentQuestionAnswer[];
	  }
	| { cmd: 'refresh_capabilities'; id: string }
	| { cmd: 'refresh_mcp_status'; id: string; sessionId: string; runId: string }
	| { cmd: 'stop_task'; id: string; sessionId: string; runId: string; taskId: string }
	| { cmd: 'suggest_title'; id: string; prompt: string; instructions: string; model: string }
	| { cmd: 'list_skills'; id: string; cwd: string; turnedOff: TurnedOffSkills }
	| ({ cmd: 'browser_result'; id: string; sessionId: string; requestId: string } & BrowserAnswer)
	| ({ cmd: 'platform_result'; id: string; sessionId: string; requestId: string } & PlatformAnswer);

export interface BrowserAnswer {
	ok: boolean;
	text?: string;
	imagePath?: string;
	error?: string;
}

export function browserResultCommand(
	id: string,
	request: BridgeBrowserRequest,
	answer: BrowserAnswer,
): BridgeCommand {
	return {
		cmd: 'browser_result',
		id,
		sessionId: request.sessionId,
		requestId: request.requestId,
		...answer,
	};
}

export type PlatformAnswer = Omit<BrowserAnswer, 'imagePath'>;

export function platformResultCommand(
	id: string,
	request: BridgePlatformRequest,
	answer: PlatformAnswer,
): BridgeCommand {
	return {
		cmd: 'platform_result',
		id,
		sessionId: request.sessionId,
		requestId: request.requestId,
		...answer,
	};
}

export function commandAcknowledgementTimeoutMs(command: BridgeCommand): number {
	if (command.cmd === 'start_session') return BRIDGE_START_SESSION_ACK_TIMEOUT_MS;
	if (command.cmd === 'suggest_title') return BRIDGE_SUGGEST_TITLE_ACK_TIMEOUT_MS;
	if (command.cmd === 'list_skills') return BRIDGE_LIST_SKILLS_ACK_TIMEOUT_MS;
	return BRIDGE_COMMAND_ACK_TIMEOUT_MS;
}

export type BridgeEvent =
	| { type: 'run.started'; runId: string; sessionId: string }
	| { type: 'user.message'; runId: string; text: string }
	| { type: 'assistant.message'; runId: string; text: string; contentId?: string }
	| { type: 'thinking.message'; runId: string; contentId: string; text: string }
	| { type: 'plan.updated'; runId: string; text: string }
	| {
			type: 'tool.started';
			runId: string;
			name: string;
			input?: unknown;
			toolCallId?: string;
			parentToolCallId?: string;
			ts?: number;
	  }
	| {
			type: 'tool.completed';
			runId: string;
			name: string;
			output?: unknown;
			toolCallId?: string;
			parentToolCallId?: string;
			ts?: number;
	  }
	| {
			type: 'tool.failed';
			runId: string;
			name: string;
			toolCallId?: string;
			parentToolCallId?: string;
			error: string;
			ts?: number;
	  }
	| {
			type: 'command.completed';
			runId: string;
			command: string;
			description?: string;
			exitCode: number;
	  }
	| { type: 'file.changed'; runId: string; path: string }
	| {
			type: 'approval.requested';
			sessionId: string;
			runId: string;
			approvalId: string;
			reason: string;
			toolName?: string;
			input?: unknown;
			permission?: unknown;
	  }
	| {
			type: 'question.requested';
			sessionId: string;
			runId: string;
			questionId: string;
			questions: AgentQuestion[];
			toolName?: string;
			toolCallId?: string;
	  }
	| {
			type: 'usage.updated';
			runId: string;
			inputTokens?: number;
			outputTokens?: number;
			costUsd?: number;
			contextTokens?: number;
			contextWindowTokens?: number;
			providerMetrics?: Record<string, unknown>;
			interim?: boolean;
	  }
	| { type: 'mcp.status'; runId: string; servers: AgentMcpServerStatus[] }
	| {
			type: 'background.updated';
			runId: string;
			waiting: boolean;
			tasks: AgentBackgroundTask[];
			summary?: string;
			interim?: boolean;
			handedOff?: boolean;
	  }
	| {
			type: 'run.completed';
			runId: string;
			summary: string;
			providerCursor?: string;
			handedOff?: boolean;
	  }
	| {
			type: 'run.failed';
			runId: string;
			error: string;
			providerCursor?: string;
			handedOff?: boolean;
	  }
	| { type: 'session.state'; sessionId: string; status: string; providerSessionId?: string }
	| { type: 'assistant.delta'; runId: string; contentId: string; text: string }
	| { type: 'thinking.delta'; runId: string; contentId: string; text: string }
	| {
			type: 'tool.input.delta';
			runId: string;
			toolCallId: string;
			name: string;
			inputJsonDelta: string;
	  }
	| { type: 'stream.discarded'; runId: string; contentIds: string[]; toolCallIds: string[] };

export type BridgeEventType = BridgeEvent['type'];

export type BridgeControlFrame =
	| {
			type: 'bridge.ready';
			contractName: string;
			protocolVersion: number;
			pid: number;
			capabilities: ProviderCapability[];
			heartbeatIntervalMs: number;
	  }
	| {
			type: 'bridge.capabilities';
			protocolVersion: number;
			capabilities: ProviderCapability[];
	  }
	| { type: 'bridge.heartbeat'; protocolVersion: number; ts: number }
	| {
			type: 'bridge.command_ack';
			protocolVersion: number;
			id: string;
			accepted: boolean;
			error?: string;
	  }
	| {
			type: 'bridge.protocol_error';
			protocolVersion: number;
			id?: string;
			runId?: string;
			sessionId?: string;
			code: string;
			message: string;
	  }
	| { type: 'bridge.title'; protocolVersion: number; id: string; title: string }
	| { type: 'bridge.skills'; protocolVersion: number; id: string; skills: SkillRecord[] }
	| BridgeBrowserRequest
	| BridgePlatformRequest;

export type BridgeAgentRequest = BridgeBrowserRequest | BridgePlatformRequest;

export type PlatformTool = (typeof BRIDGE_PLATFORM_TOOLS)[number];

export type BridgePlatformRequest = {
	type: 'bridge.platform_request';
	protocolVersion: number;
	requestId: string;
	sessionId: string;
	runId: string;
	tool: PlatformTool;
	input: Record<string, unknown>;
};

export type BrowserRequestAction =
	| { action: 'open'; url: string }
	| { action: 'screenshot' }
	| { action: 'click'; selector: string }
	| { action: 'type'; selector: string; text: string; submit: boolean }
	| { action: 'back' }
	| { action: 'forward' }
	| { action: 'reload' };

export type BridgeBrowserRequest = {
	type: 'bridge.browser_request';
	protocolVersion: number;
	requestId: string;
	sessionId: string;
} & BrowserRequestAction;

export type Decoded<T> = { ok: true; value: T } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class Fields {
	constructor(
		private readonly obj: Record<string, unknown>,
		private readonly frame: string,
	) {}

	string(key: string): string {
		const value = this.obj[key];
		if (typeof value !== 'string') throw new Error(this.missing(key, 'a string'));
		return value;
	}

	optionalString(key: string): string | undefined {
		const value = this.obj[key];
		if (value === undefined || value === null) return undefined;
		if (typeof value !== 'string') throw new Error(this.missing(key, 'a string'));
		return value;
	}

	number(key: string): number {
		const value = this.obj[key];
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			throw new Error(this.missing(key, 'a number'));
		}
		return value;
	}

	optionalNumber(key: string): number | undefined {
		const value = this.obj[key];
		if (value === undefined || value === null) return undefined;
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			throw new Error(this.missing(key, 'a number'));
		}
		return value;
	}

	boolean(key: string): boolean {
		const value = this.obj[key];
		if (typeof value !== 'boolean') throw new Error(this.missing(key, 'a boolean'));
		return value;
	}

	optionalBoolean(key: string): boolean | undefined {
		const value = this.obj[key];
		if (value === undefined || value === null) return undefined;
		if (typeof value !== 'boolean') throw new Error(this.missing(key, 'a boolean'));
		return value;
	}

	optionalValue(key: string): unknown {
		const value = this.obj[key];
		return value === null ? undefined : value;
	}

	optionalRecord(key: string): Record<string, unknown> | undefined {
		const value = this.obj[key];
		if (value === undefined || value === null) return undefined;
		if (!isRecord(value)) throw new Error(this.missing(key, 'an object'));
		return value;
	}

	stringArray(key: string): string[] {
		const value = this.obj[key];
		if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
			throw new Error(this.missing(key, 'an array of strings'));
		}
		return value;
	}

	array(key: string): unknown[] {
		const value = this.obj[key];
		if (!Array.isArray(value)) throw new Error(this.missing(key, 'an array'));
		return value;
	}

	private missing(key: string, expected: string): string {
		return `${this.frame}: field \`${key}\` must be ${expected}`;
	}
}

function optional<T>(key: string, value: T | undefined): Record<string, T> {
	const fields: Record<string, T> = {};
	if (value !== undefined) fields[key] = value;
	return fields;
}

function decodeQuestion(value: unknown, index: number): AgentQuestion {
	if (!isRecord(value)) throw new Error(`question.requested: questions[${index}] is not an object`);
	const fields = new Fields(value, `question.requested: questions[${index}]`);
	const options = fields.array('options').map((option, optionIndex) => {
		if (!isRecord(option)) {
			throw new Error(
				`question.requested: questions[${index}].options[${optionIndex}] is not an object`,
			);
		}
		const optionFields = new Fields(
			option,
			`question.requested: questions[${index}].options[${optionIndex}]`,
		);
		return {
			label: optionFields.string('label'),
			...optional('description', optionFields.optionalString('description')),
		};
	});
	return {
		id: fields.string('id'),
		prompt: fields.string('prompt'),
		...optional('header', fields.optionalString('header')),
		options,
		multiSelect: fields.boolean('multiSelect'),
		allowFreeText: fields.boolean('allowFreeText'),
	};
}

function decodeMcpServer(value: unknown, index: number): AgentMcpServerStatus {
	if (!isRecord(value)) throw new Error(`mcp.status: servers[${index}] is not an object`);
	const fields = new Fields(value, `mcp.status: servers[${index}]`);
	return {
		name: fields.string('name'),
		status: fields.string('status'),
		...optional('error', fields.optionalString('error')),
	};
}

const SKILL_SOURCES: ReadonlySet<string> = new Set<SkillSource>([
	'personal',
	'repository',
	'plugin',
	'claude-code',
	'other',
]);

function decodeSkill(value: unknown, index: number): SkillRecord {
	if (!isRecord(value)) throw new Error(`bridge.skills: skills[${index}] is not an object`);
	const fields = new Fields(value, `bridge.skills: skills[${index}]`);
	const source = fields.string('source');
	return {
		name: fields.string('name'),
		description: fields.string('description'),
		source: isSkillSource(source) ? source : 'other',
		tokens: fields.number('tokens'),
	};
}

function isSkillSource(value: string): value is SkillSource {
	return SKILL_SOURCES.has(value);
}

function isBackgroundTaskKind(value: string): value is AgentBackgroundTaskKind {
	return AGENT_BACKGROUND_TASK_KINDS.some((kind) => kind === value);
}

function decodeBackgroundTask(value: unknown, index: number): AgentBackgroundTask {
	if (!isRecord(value)) throw new Error(`background.updated: tasks[${index}] is not an object`);
	const fields = new Fields(value, `background.updated: tasks[${index}]`);
	const kind = fields.string('kind');
	if (!isBackgroundTaskKind(kind)) {
		throw new Error(`background.updated: tasks[${index}].kind \`${kind}\` is unknown`);
	}
	return {
		taskId: fields.string('taskId'),
		kind,
		description: fields.string('description'),
		startedAt: fields.number('startedAt'),
		...optional('toolCallId', fields.optionalString('toolCallId')),
		...optional('detail', fields.optionalString('detail')),
	};
}

const EVENT_TYPES: ReadonlySet<string> = new Set(BRIDGE_EVENT_TYPES);

function isEventType(value: string): value is BridgeEventType {
	return EVENT_TYPES.has(value);
}

export function decodeBridgeEvent(value: unknown): Decoded<BridgeEvent> {
	try {
		if (!isRecord(value)) return { ok: false, error: 'event frame is not an object' };
		const type = value['type'];
		if (typeof type !== 'string') return { ok: false, error: 'event frame has no `type`' };
		if (!isEventType(type)) return { ok: false, error: `unknown event type \`${type}\`` };
		const f = new Fields(value, type);
		const kind = type;
		switch (kind) {
			case 'run.started':
				return ok({ type: kind, runId: f.string('runId'), sessionId: f.string('sessionId') });
			case 'user.message':
			case 'plan.updated':
				return ok({ type: kind, runId: f.string('runId'), text: f.string('text') });
			case 'assistant.message':
				return ok({
					type: kind,
					runId: f.string('runId'),
					text: f.string('text'),
					...optional('contentId', f.optionalString('contentId')),
				});
			case 'thinking.message':
			case 'assistant.delta':
			case 'thinking.delta':
				return ok({
					type: kind,
					runId: f.string('runId'),
					contentId: f.string('contentId'),
					text: f.string('text'),
				});
			case 'tool.started':
				return ok({
					type: kind,
					runId: f.string('runId'),
					name: f.string('name'),
					...optional('input', f.optionalValue('input')),
					...optional('toolCallId', f.optionalString('toolCallId')),
					...optional('parentToolCallId', f.optionalString('parentToolCallId')),
					...optional('ts', f.optionalNumber('ts')),
				});
			case 'tool.completed':
				return ok({
					type: kind,
					runId: f.string('runId'),
					name: f.string('name'),
					...optional('output', f.optionalValue('output')),
					...optional('toolCallId', f.optionalString('toolCallId')),
					...optional('parentToolCallId', f.optionalString('parentToolCallId')),
					...optional('ts', f.optionalNumber('ts')),
				});
			case 'tool.failed':
				return ok({
					type: kind,
					runId: f.string('runId'),
					name: f.string('name'),
					...optional('toolCallId', f.optionalString('toolCallId')),
					...optional('parentToolCallId', f.optionalString('parentToolCallId')),
					error: f.string('error'),
					...optional('ts', f.optionalNumber('ts')),
				});
			case 'command.completed':
				return ok({
					type: kind,
					runId: f.string('runId'),
					command: f.string('command'),
					...optional('description', f.optionalString('description')),
					exitCode: f.number('exitCode'),
				});
			case 'file.changed':
				return ok({ type: kind, runId: f.string('runId'), path: f.string('path') });
			case 'approval.requested':
				return ok({
					type: kind,
					sessionId: f.string('sessionId'),
					runId: f.string('runId'),
					approvalId: f.string('approvalId'),
					reason: f.string('reason'),
					...optional('toolName', f.optionalString('toolName')),
					...optional('input', f.optionalValue('input')),
					...optional('permission', f.optionalValue('permission')),
				});
			case 'question.requested':
				return ok({
					type: kind,
					sessionId: f.string('sessionId'),
					runId: f.string('runId'),
					questionId: f.string('questionId'),
					questions: f.array('questions').map(decodeQuestion),
					...optional('toolName', f.optionalString('toolName')),
					...optional('toolCallId', f.optionalString('toolCallId')),
				});
			case 'usage.updated':
				return ok({
					type: kind,
					runId: f.string('runId'),
					...optional('inputTokens', f.optionalNumber('inputTokens')),
					...optional('outputTokens', f.optionalNumber('outputTokens')),
					...optional('costUsd', f.optionalNumber('costUsd')),
					...optional('contextTokens', f.optionalNumber('contextTokens')),
					...optional('contextWindowTokens', f.optionalNumber('contextWindowTokens')),
					...optional('providerMetrics', f.optionalRecord('providerMetrics')),
					...optional('interim', f.optionalBoolean('interim')),
				});
			case 'mcp.status':
				return ok({
					type: kind,
					runId: f.string('runId'),
					servers: f.array('servers').map(decodeMcpServer),
				});
			case 'background.updated':
				return ok({
					type: kind,
					runId: f.string('runId'),
					waiting: f.boolean('waiting'),
					tasks: f.array('tasks').map(decodeBackgroundTask),
					...optional('summary', f.optionalString('summary')),
					...optional('interim', f.optionalBoolean('interim')),
					...optional('handedOff', f.optionalBoolean('handedOff')),
				});
			case 'run.completed':
				return ok({
					type: kind,
					runId: f.string('runId'),
					summary: f.string('summary'),
					...optional('providerCursor', f.optionalString('providerCursor')),
					...optional('handedOff', f.optionalBoolean('handedOff')),
				});
			case 'run.failed':
				return ok({
					type: kind,
					runId: f.string('runId'),
					error: f.string('error'),
					...optional('providerCursor', f.optionalString('providerCursor')),
					...optional('handedOff', f.optionalBoolean('handedOff')),
				});
			case 'session.state':
				return ok({
					type: kind,
					sessionId: f.string('sessionId'),
					status: f.string('status'),
					...optional('providerSessionId', f.optionalString('providerSessionId')),
				});
			case 'tool.input.delta':
				return ok({
					type: kind,
					runId: f.string('runId'),
					toolCallId: f.string('toolCallId'),
					name: f.string('name'),
					inputJsonDelta: f.string('inputJsonDelta'),
				});
			case 'stream.discarded':
				return ok({
					type: kind,
					runId: f.string('runId'),
					contentIds: f.stringArray('contentIds'),
					toolCallIds: f.stringArray('toolCallIds'),
				});
		}
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

function ok(value: BridgeEvent): Decoded<BridgeEvent> {
	return { ok: true, value };
}

function decodeCapability(value: unknown, index: number): ProviderCapability {
	if (!isRecord(value)) throw new Error(`capabilities[${index}] is not an object`);
	const f = new Fields(value, `capabilities[${index}]`);
	const state = f.string('state');
	if (state !== 'ready' && state !== 'needs_auth' && state !== 'missing' && state !== 'unknown') {
		throw new Error(`capabilities[${index}]: unknown state \`${state}\``);
	}
	const authenticated = value['authenticated'];
	if (authenticated !== null && authenticated !== undefined && typeof authenticated !== 'boolean') {
		throw new Error(`capabilities[${index}]: field \`authenticated\` must be a boolean or null`);
	}
	const account = f.optionalRecord('account');
	return {
		state,
		installed: f.boolean('installed'),
		authenticated: authenticated ?? null,
		version: f.optionalString('version') ?? null,
		account: account === undefined ? null : decodeAccount(account, index),
		models: f.array('models').map((model, modelIndex) => decodeModel(model, index, modelIndex)),
		defaultModel: f.string('defaultModel'),
		message: f.string('message'),
	};
}

function decodeAccount(value: Record<string, unknown>, index: number): AgentAccount {
	const f = new Fields(value, `capabilities[${index}].account`);
	return {
		...optional('email', f.optionalString('email')),
		...optional('plan', f.optionalString('plan')),
	};
}

const REASONING_EFFORTS: ReadonlySet<string> = new Set<AgentReasoningEffort>([
	'low',
	'medium',
	'high',
	'xhigh',
	'max',
]);

function isReasoningEffort(value: string): value is AgentReasoningEffort {
	return REASONING_EFFORTS.has(value);
}

function decodeModel(value: unknown, index: number, modelIndex: number): AgentModelInfo {
	const frame = `capabilities[${index}].models[${modelIndex}]`;
	if (!isRecord(value)) throw new Error(`${frame} is not an object`);
	const f = new Fields(value, frame);
	const efforts = f.stringArray('efforts');
	if (!efforts.every(isReasoningEffort)) {
		throw new Error(`${frame}: field \`efforts\` must hold only known reasoning efforts`);
	}
	return {
		id: f.string('id'),
		label: f.string('label'),
		description: f.string('description'),
		efforts,
	};
}

export function decodeControlFrame(value: unknown): Decoded<BridgeControlFrame> {
	try {
		if (!isRecord(value)) return { ok: false, error: 'control frame is not an object' };
		const type = value['type'];
		if (typeof type !== 'string') return { ok: false, error: 'control frame has no `type`' };
		const f = new Fields(value, type);
		switch (type) {
			case 'bridge.ready':
				return {
					ok: true,
					value: {
						type,
						contractName: f.string('contractName'),
						protocolVersion: f.number('protocolVersion'),
						pid: f.number('pid'),
						capabilities: f.array('capabilities').map(decodeCapability),
						heartbeatIntervalMs: f.number('heartbeatIntervalMs'),
					},
				};
			case 'bridge.capabilities':
				return {
					ok: true,
					value: {
						type,
						protocolVersion: f.number('protocolVersion'),
						capabilities: f.array('capabilities').map(decodeCapability),
					},
				};
			case 'bridge.heartbeat':
				return {
					ok: true,
					value: { type, protocolVersion: f.number('protocolVersion'), ts: f.number('ts') },
				};
			case 'bridge.command_ack':
				return {
					ok: true,
					value: {
						type,
						protocolVersion: f.number('protocolVersion'),
						id: f.string('id'),
						accepted: f.boolean('accepted'),
						...optional('error', f.optionalString('error')),
					},
				};
			case 'bridge.protocol_error':
				return {
					ok: true,
					value: {
						type,
						protocolVersion: f.number('protocolVersion'),
						...optional('id', f.optionalString('id')),
						...optional('runId', f.optionalString('runId')),
						...optional('sessionId', f.optionalString('sessionId')),
						code: f.string('code'),
						message: f.string('message'),
					},
				};
			case 'bridge.title':
				return {
					ok: true,
					value: {
						type,
						protocolVersion: f.number('protocolVersion'),
						id: f.string('id'),
						title: f.string('title'),
					},
				};
			case 'bridge.skills':
				return {
					ok: true,
					value: {
						type,
						protocolVersion: f.number('protocolVersion'),
						id: f.string('id'),
						skills: f.array('skills').map(decodeSkill),
					},
				};
			case 'bridge.browser_request':
				return decodeBrowserRequest(type, f);
			case 'bridge.platform_request':
				return decodePlatformRequest(type, f);
			default:
				return { ok: false, error: `unknown variant \`${type}\`` };
		}
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

function decodePlatformRequest(
	type: 'bridge.platform_request',
	f: Fields,
): Decoded<BridgeControlFrame> {
	const requestId = f.string('requestId');
	const sessionId = f.string('sessionId');
	const runId = f.string('runId');
	if (requestId.length === 0 || sessionId.length === 0 || runId.length === 0) {
		return {
			ok: false,
			error: `${type}: \`requestId\`, \`sessionId\` and \`runId\` must not be empty`,
		};
	}
	const tool = f.string('tool');
	if (!isPlatformTool(tool)) return { ok: false, error: `${type}: unknown tool \`${tool}\`` };
	const input = f.optionalRecord('input');
	if (!input) return { ok: false, error: `${type}: field \`input\` must be an object` };
	const protocolVersion = f.number('protocolVersion');
	return { ok: true, value: { type, protocolVersion, requestId, sessionId, runId, tool, input } };
}

function isPlatformTool(value: string): value is PlatformTool {
	return BRIDGE_PLATFORM_TOOLS.some((tool) => tool === value);
}

function decodeBrowserRequest(
	type: 'bridge.browser_request',
	f: Fields,
): Decoded<BridgeControlFrame> {
	const requestId = f.string('requestId');
	const sessionId = f.string('sessionId');
	if (requestId.length === 0 || sessionId.length === 0) {
		return { ok: false, error: `${type}: \`requestId\` and \`sessionId\` must not be empty` };
	}
	const base = { type, protocolVersion: f.number('protocolVersion'), requestId, sessionId };
	const action = f.string('action');
	switch (action) {
		case 'open':
			return { ok: true, value: { ...base, action, url: f.string('url') } };
		case 'screenshot':
		case 'back':
		case 'forward':
		case 'reload':
			return { ok: true, value: { ...base, action } };
		case 'click':
			return { ok: true, value: { ...base, action, selector: f.string('selector') } };
		case 'type':
			return {
				ok: true,
				value: {
					...base,
					action,
					selector: f.string('selector'),
					text: f.string('text'),
					submit: f.boolean('submit'),
				},
			};
		default:
			return { ok: false, error: `${type}: unknown action \`${action}\`` };
	}
}

export function eventRunId(event: BridgeEvent): string | null {
	return event.type === 'session.state' ? null : event.runId;
}

export function eventSessionId(event: BridgeEvent): string | null {
	switch (event.type) {
		case 'run.started':
		case 'approval.requested':
		case 'question.requested':
		case 'session.state':
			return event.sessionId;
		default:
			return null;
	}
}

export function isEphemeralEvent(event: BridgeEvent): boolean {
	switch (event.type) {
		case 'assistant.delta':
		case 'thinking.delta':
		case 'tool.input.delta':
		case 'stream.discarded':
			return true;
		case 'usage.updated':
		case 'background.updated':
			return event.interim === true;
		default:
			return false;
	}
}

export function isTerminalEvent(
	event: BridgeEvent,
): event is Extract<BridgeEvent, { type: 'run.completed' | 'run.failed' }> {
	return event.type === 'run.completed' || event.type === 'run.failed';
}

export function eventToPersistable(event: BridgeEvent): {
	kind: string;
	payload: Record<string, unknown>;
} {
	const payload: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(event)) {
		if (key !== 'type' && key !== 'runId' && key !== 'sessionId') payload[key] = value;
	}
	return { kind: event.type, payload };
}

export function validateCapabilities(capabilities: readonly ProviderCapability[]): void {
	if (capabilities.length === 0) throw new Error('capabilities must contain at least one entry');
	if (capabilities.length > 1) throw new Error('capabilities must contain exactly one entry');

	for (const capability of capabilities) {
		const modelIds = new Set<string>();
		for (const { id } of capability.models) {
			if (id.length === 0 || id.trim() !== id) {
				throw new Error('the agent reported an empty or whitespace-padded model id');
			}
			if (modelIds.has(id)) {
				throw new Error(`the agent reported duplicate model \`${id}\``);
			}
			modelIds.add(id);
		}
		if (capability.defaultModel.length > 0 && !modelIds.has(capability.defaultModel)) {
			throw new Error(
				`the agent default model \`${capability.defaultModel}\` is absent from its models`,
			);
		}
		if (capability.state !== 'ready' && capability.account !== null) {
			throw new Error(`a ${capability.state} agent cannot report a signed-in account`);
		}

		switch (capability.state) {
			case 'ready':
				if (!capability.installed) {
					throw new Error('a ready agent must report installed=true');
				}
				if (capability.authenticated !== true) {
					throw new Error('a ready agent must report authenticated=true');
				}
				if (capability.models.length === 0 || capability.defaultModel.length === 0) {
					throw new Error('a ready agent must report models and a defaultModel');
				}
				break;
			case 'needs_auth':
				if (!capability.installed || capability.authenticated !== false) {
					throw new Error('a needs_auth agent must report installed=true and authenticated=false');
				}
				break;
			case 'missing':
				if (capability.installed || capability.authenticated !== null) {
					throw new Error('a missing agent must report installed=false and authenticated=null');
				}
				break;
			case 'unknown':
				if (capability.authenticated !== null) {
					throw new Error('an unknown agent must report authenticated=null');
				}
				break;
		}
	}
}

export function readyFrameMismatch(frame: {
	contractName: string;
	protocolVersion: number;
	heartbeatIntervalMs: number;
}): string | null {
	if (
		frame.contractName !== BRIDGE_CONTRACT_NAME ||
		frame.protocolVersion !== BRIDGE_PROTOCOL_VERSION ||
		frame.heartbeatIntervalMs !== BRIDGE_HEARTBEAT_INTERVAL_MS
	) {
		return `PROTOCOL_MISMATCH: expected ${BRIDGE_CONTRACT_NAME} v${BRIDGE_PROTOCOL_VERSION} heartbeat=${BRIDGE_HEARTBEAT_INTERVAL_MS}ms, got ${frame.contractName} v${frame.protocolVersion} heartbeat=${frame.heartbeatIntervalMs}ms`;
	}
	return null;
}
