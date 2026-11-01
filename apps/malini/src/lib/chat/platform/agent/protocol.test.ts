import { describe, expect, it } from 'vitest';
import {
	BRIDGE_COMMAND_ACK_TIMEOUT_MS,
	BRIDGE_CONTRACT_NAME,
	BRIDGE_PROTOCOL_VERSION,
	BRIDGE_START_SESSION_ACK_TIMEOUT_MS,
	browserResultCommand,
	commandAcknowledgementTimeoutMs,
	decodeBridgeEvent,
	decodeControlFrame,
	historyResultCommand,
	eventRunId,
	eventSessionId,
	eventToPersistable,
	isEphemeralEvent,
	platformResultCommand,
	readyFrameMismatch,
	validateCapabilities,
	type BridgeBrowserRequest,
	type BridgeEvent,
	type ProviderCapability,
} from './protocol';
import type { AgentModelInfo } from '$contract/agent';

function capability(overrides: Partial<ProviderCapability> = {}): ProviderCapability {
	return {
		state: 'ready',
		installed: true,
		authenticated: true,
		version: 'fixture',
		account: { email: 'me@example.com', plan: 'Claude Max' },
		models: [model('sonnet')],
		defaultModel: 'sonnet',
		message: 'Ready',
		...overrides,
	};
}

function model(id: string): AgentModelInfo {
	return { id, label: id, description: '', efforts: ['low', 'high'] };
}

function decode(value: unknown): BridgeEvent {
	const decoded = decodeBridgeEvent(value);
	if (!decoded.ok) throw new Error(decoded.error);
	return decoded.value;
}

describe('event frames', () => {
	it('wire-locks the persisted variants field for field', () => {
		expect(decode({ type: 'run.started', runId: 'r', sessionId: 's' })).toEqual({
			type: 'run.started',
			runId: 'r',
			sessionId: 's',
		});
		expect(decode({ type: 'user.message', runId: 'r', text: 'hi' })).toEqual({
			type: 'user.message',
			runId: 'r',
			text: 'hi',
		});
		expect(decode({ type: 'assistant.message', runId: 'r', text: 'a', contentId: 'c' })).toEqual({
			type: 'assistant.message',
			runId: 'r',
			text: 'a',
			contentId: 'c',
		});
		expect(decode({ type: 'thinking.message', runId: 'r', contentId: 'c', text: 't' })).toEqual({
			type: 'thinking.message',
			runId: 'r',
			contentId: 'c',
			text: 't',
		});
		expect(decode({ type: 'tool.failed', runId: 'r', name: 'n', error: 'e', ts: 5 })).toEqual({
			type: 'tool.failed',
			runId: 'r',
			name: 'n',
			error: 'e',
			ts: 5,
		});
		expect(decode({ type: 'command.completed', runId: 'r', command: 'ls', exitCode: 0 })).toEqual({
			type: 'command.completed',
			runId: 'r',
			command: 'ls',
			exitCode: 0,
		});
		expect(
			decode({ type: 'mcp.status', runId: 'r', servers: [{ name: 'fs', status: 'ok' }] }),
		).toEqual({
			type: 'mcp.status',
			runId: 'r',
			servers: [{ name: 'fs', status: 'ok' }],
		});
		const task = { taskId: 'b1', kind: 'command', description: 'e2e', startedAt: 5, detail: 'ok' };
		expect(
			decode({ type: 'background.updated', runId: 'r', waiting: true, tasks: [task] }),
		).toEqual({ type: 'background.updated', runId: 'r', waiting: true, tasks: [task] });
		expect(
			decode({ type: 'background.updated', runId: 'r', waiting: true, tasks: [], summary: 'up' }),
		).toEqual({ type: 'background.updated', runId: 'r', waiting: true, tasks: [], summary: 'up' });
		expect(
			decodeBridgeEvent({
				type: 'background.updated',
				runId: 'r',
				waiting: true,
				tasks: [{ ...task, kind: 'x' }],
			}),
		).toMatchObject({ ok: false });
		expect(
			decode({ type: 'run.completed', runId: 'r', summary: 's', providerCursor: 'uuid-1' }),
		).toEqual({ type: 'run.completed', runId: 'r', summary: 's', providerCursor: 'uuid-1' });
		expect(decode({ type: 'run.completed', runId: 'r', summary: 's', handedOff: true })).toEqual({
			type: 'run.completed',
			runId: 'r',
			summary: 's',
			handedOff: true,
		});
		expect(decode({ type: 'run.failed', runId: 'r', error: 'e', providerCursor: null })).toEqual({
			type: 'run.failed',
			runId: 'r',
			error: 'e',
		});
		expect(
			decode({
				type: 'run.failed',
				runId: 'r',
				error: "You've hit your session limit",
				failure: { kind: 'usage-limit', resetsAt: '2026-10-27T14:31:13.000Z', status: 429 },
			}),
		).toEqual({
			type: 'run.failed',
			runId: 'r',
			error: "You've hit your session limit",
			failure: { kind: 'usage-limit', resetsAt: '2026-10-27T14:31:13.000Z', status: 429 },
		});
		expect(
			decode({
				type: 'run.failed',
				runId: 'r',
				error: 'e',
				failure: { kind: 'solar-flare', resetsAt: 'soon', status: 'x' },
			}),
		).toEqual({ type: 'run.failed', runId: 'r', error: 'e' });
		expect(
			decode({
				type: 'run.failed',
				runId: 'r',
				error: 'e',
				failure: { kind: 'overloaded', resetsAt: 'soon', status: 529.5 },
			}),
		).toEqual({ type: 'run.failed', runId: 'r', error: 'e', failure: { kind: 'overloaded' } });
		expect(
			decode({ type: 'session.state', sessionId: 's', status: 'idle', providerSessionId: 'p' }),
		).toEqual({
			type: 'session.state',
			sessionId: 's',
			status: 'idle',
			providerSessionId: 'p',
		});
	});

	it('keeps the parent tool call id a subagent stamps on its tool events', () => {
		expect(
			decode({
				type: 'tool.started',
				runId: 'r',
				name: 'grep',
				toolCallId: 'c-1',
				parentToolCallId: 'task-1',
			}),
		).toEqual({
			type: 'tool.started',
			runId: 'r',
			name: 'grep',
			toolCallId: 'c-1',
			parentToolCallId: 'task-1',
		});
		expect(
			decode({ type: 'tool.completed', runId: 'r', name: 'grep', parentToolCallId: 'task-1' }),
		).toEqual({ type: 'tool.completed', runId: 'r', name: 'grep', parentToolCallId: 'task-1' });
		expect(
			decode({
				type: 'tool.failed',
				runId: 'r',
				name: 'grep',
				error: 'x',
				parentToolCallId: 'task-1',
			}),
		).toEqual({
			type: 'tool.failed',
			runId: 'r',
			name: 'grep',
			error: 'x',
			parentToolCallId: 'task-1',
		});
	});

	it('keeps that auto mode could not check a call it asks about', () => {
		const unchecked = {
			type: 'approval.requested',
			sessionId: 's',
			runId: 'r',
			approvalId: 'a',
			reason: "Auto mode couldn't check this call: Anthropic's safety check is down.",
			autoModeUnavailable: true,
		};
		expect(decode(unchecked)).toEqual(unchecked);
	});

	it('drops optional fields that arrive as null, like serde Option', () => {
		const event = decode({
			type: 'tool.started',
			runId: 'r',
			name: 'n',
			input: null,
			toolCallId: null,
			ts: null,
		});
		expect(event).toEqual({ type: 'tool.started', runId: 'r', name: 'n' });
		expect(decode({ type: 'tool.completed', runId: 'r', name: 'n', output: 'done' })).toEqual({
			type: 'tool.completed',
			runId: 'r',
			name: 'n',
			output: 'done',
		});
	});

	it('rejects missing required fields, mistyped optionals, and unknown types', () => {
		expect(decodeBridgeEvent({ type: 'run.started', runId: 'r' })).toMatchObject({
			ok: false,
			error: 'run.started: field `sessionId` must be a string',
		});
		expect(
			decodeBridgeEvent({ type: 'assistant.message', runId: 'r', text: 'a', contentId: 7 }),
		).toMatchObject({
			ok: false,
		});
		expect(
			decodeBridgeEvent({ type: 'command.completed', runId: 'r', command: 'ls', exitCode: '0' }),
		).toMatchObject({
			ok: false,
		});
		expect(decodeBridgeEvent({ type: 'nope', runId: 'r' })).toEqual({
			ok: false,
			error: 'unknown event type `nope`',
		});
		expect(decodeBridgeEvent('text')).toMatchObject({ ok: false });
		expect(decodeBridgeEvent({ runId: 'r' })).toMatchObject({ ok: false });
	});

	it('decodes a discarded stream and rejects ids that are not strings', () => {
		const discarded = {
			type: 'stream.discarded',
			runId: 'r',
			contentIds: ['msg_1:0'],
			toolCallIds: ['toolu_1'],
		};
		expect(decode(discarded)).toEqual(discarded);
		expect(decodeBridgeEvent({ ...discarded, toolCallIds: [7] })).toEqual({
			ok: false,
			error: 'stream.discarded: field `toolCallIds` must be an array of strings',
		});
	});

	it('validates question.requested strictly, including nested options', () => {
		const good = decode({
			type: 'question.requested',
			sessionId: 's',
			runId: 'r',
			questionId: 'q',
			questions: [
				{
					id: 'q1',
					prompt: 'Which?',
					options: [{ label: 'A' }, { label: 'B', description: 'd' }],
					multiSelect: false,
					allowFreeText: true,
				},
			],
			toolCallId: 'tu',
		});
		expect(good).toMatchObject({ type: 'question.requested', questionId: 'q', toolCallId: 'tu' });
		expect(
			decodeBridgeEvent({
				type: 'question.requested',
				sessionId: 's',
				runId: 'r',
				questionId: 'q',
				questions: [
					{ id: 'q1', prompt: 'Which?', options: [], multiSelect: 'no', allowFreeText: false },
				],
			}),
		).toMatchObject({
			ok: false,
			error: 'question.requested: questions[0]: field `multiSelect` must be a boolean',
		});
	});

	it('identifies run, session, ephemeral, and persistable shape', () => {
		const table: Array<[BridgeEvent, boolean]> = [
			[{ type: 'assistant.delta', runId: 'r', contentId: 'c', text: 't' }, true],
			[{ type: 'thinking.delta', runId: 'r', contentId: 'c', text: 't' }, true],
			[
				{ type: 'tool.input.delta', runId: 'r', toolCallId: 'c', name: 'n', inputJsonDelta: '{' },
				true,
			],
			[{ type: 'stream.discarded', runId: 'r', contentIds: [], toolCallIds: ['c'] }, true],
			[{ type: 'usage.updated', runId: 'r', interim: true }, true],
			[{ type: 'usage.updated', runId: 'r', interim: false }, false],
			[{ type: 'usage.updated', runId: 'r' }, false],
			[{ type: 'background.updated', runId: 'r', waiting: false, tasks: [], interim: true }, true],
			[{ type: 'background.updated', runId: 'r', waiting: true, tasks: [] }, false],
			[{ type: 'assistant.message', runId: 'r', text: 't' }, false],
			[{ type: 'run.completed', runId: 'r', summary: 's' }, false],
			[{ type: 'session.state', sessionId: 's', status: 'idle' }, false],
		];
		for (const [event, ephemeral] of table) expect(isEphemeralEvent(event)).toBe(ephemeral);

		expect(eventRunId({ type: 'session.state', sessionId: 's', status: 'idle' })).toBeNull();
		expect(eventRunId({ type: 'file.changed', runId: 'r', path: 'p' })).toBe('r');
		expect(eventSessionId({ type: 'file.changed', runId: 'r', path: 'p' })).toBeNull();
		expect(
			eventSessionId({
				type: 'approval.requested',
				sessionId: 's',
				runId: 'r',
				approvalId: 'a',
				reason: 'x',
			}),
		).toBe('s');

		expect(
			eventToPersistable({
				type: 'approval.requested',
				sessionId: 's',
				runId: 'r',
				approvalId: 'a',
				reason: 'x',
			}),
		).toEqual({ kind: 'approval.requested', payload: { approvalId: 'a', reason: 'x' } });
	});
});

describe('MCP server frames', () => {
	it('decodes what a watched folder lists and where a switch reached', () => {
		const listed = {
			type: 'bridge.mcp_servers',
			protocolVersion: BRIDGE_PROTOCOL_VERSION,
			cwd: '/work/one',
			servers: [{ name: 'linear', status: 'pending', source: 'user' }],
			settled: false,
		};
		expect(decodeControlFrame(listed)).toEqual({ ok: true, value: listed });
		const switched = {
			type: 'bridge.mcp_switched',
			protocolVersion: BRIDGE_PROTOCOL_VERSION,
			id: 'switch-1',
			folders: ['/work/one'],
		};
		expect(decodeControlFrame(switched)).toEqual({ ok: true, value: switched });
		expect(decodeControlFrame({ ...switched, folders: [1] })).toMatchObject({ ok: false });
	});
});

describe('browser requests', () => {
	const frame = {
		type: 'bridge.browser_request',
		protocolVersion: BRIDGE_PROTOCOL_VERSION,
		requestId: 'req-1',
		sessionId: 'sess-1',
	};

	it('decodes each action the agent can ask for', () => {
		expect(decodeControlFrame({ ...frame, action: 'open', url: 'localhost:5173' })).toEqual({
			ok: true,
			value: { ...frame, action: 'open', url: 'localhost:5173' },
		});
		expect(decodeControlFrame({ ...frame, action: 'screenshot', url: 'ignored' })).toEqual({
			ok: true,
			value: { ...frame, action: 'screenshot' },
		});
		expect(decodeControlFrame({ ...frame, action: 'click', selector: '#buy' })).toEqual({
			ok: true,
			value: { ...frame, action: 'click', selector: '#buy' },
		});
		const typing = { action: 'type', selector: '#q', text: 'malini', submit: true };
		expect(decodeControlFrame({ ...frame, ...typing })).toEqual({
			ok: true,
			value: { ...frame, ...typing },
		});
		for (const action of ['back', 'forward', 'reload']) {
			expect(decodeControlFrame({ ...frame, action })).toEqual({
				ok: true,
				value: { ...frame, action },
			});
		}
		expect(decodeControlFrame({ ...frame, action: 'resize', width: 1280 })).toEqual({
			ok: true,
			value: { ...frame, action: 'resize', width: 1280 },
		});
	});

	it('refuses a request it cannot route or act on', () => {
		expect(decodeControlFrame({ ...frame, action: 'scroll' })).toEqual({
			ok: false,
			error: 'bridge.browser_request: unknown action `scroll`',
		});
		expect(decodeControlFrame({ ...frame, action: 'open' })).toEqual({
			ok: false,
			error: 'bridge.browser_request: field `url` must be a string',
		});
		expect(decodeControlFrame({ ...frame, action: 'click' })).toMatchObject({ ok: false });
		for (const width of [0, -320, 1280.5]) {
			expect(decodeControlFrame({ ...frame, action: 'resize', width })).toEqual({
				ok: false,
				error: 'bridge.browser_request: `width` must be a whole number above zero',
			});
		}
		expect(decodeControlFrame({ ...frame, action: 'resize' })).toMatchObject({ ok: false });
		expect(
			decodeControlFrame({ ...frame, action: 'type', selector: '#q', text: 'x' }),
		).toMatchObject({ ok: false });
		expect(decodeControlFrame({ ...frame, sessionId: '', action: 'screenshot' })).toEqual({
			ok: false,
			error: 'bridge.browser_request: `requestId` and `sessionId` must not be empty',
		});
		expect(decodeControlFrame({ ...frame, requestId: 7, action: 'screenshot' })).toMatchObject({
			ok: false,
		});
	});

	it('answers a request on the command channel with its ids', () => {
		const request: BridgeBrowserRequest = {
			...frame,
			type: 'bridge.browser_request',
			action: 'screenshot',
		};
		expect(
			browserResultCommand('cmd-9', request, {
				ok: true,
				text: 'Screenshot saved.',
				imagePath: '/tmp/shot.jpg',
			}),
		).toEqual({
			cmd: 'browser_result',
			id: 'cmd-9',
			sessionId: 'sess-1',
			requestId: 'req-1',
			ok: true,
			text: 'Screenshot saved.',
			imagePath: '/tmp/shot.jpg',
		});
		expect(browserResultCommand('cmd-10', request, { ok: false, error: 'No page.' })).toEqual({
			cmd: 'browser_result',
			id: 'cmd-10',
			sessionId: 'sess-1',
			requestId: 'req-1',
			ok: false,
			error: 'No page.',
		});
		expect(commandAcknowledgementTimeoutMs(browserResultCommand('c', request, { ok: true }))).toBe(
			BRIDGE_COMMAND_ACK_TIMEOUT_MS,
		);
	});
});

describe('history requests', () => {
	const frame = {
		type: 'bridge.history_request',
		protocolVersion: BRIDGE_PROTOCOL_VERSION,
		requestId: 'req-1',
		sessionId: 'sess-1',
	} as const;

	it('decodes a request for the chat record and answers it with its ids', () => {
		expect(decodeControlFrame(frame)).toEqual({ ok: true, value: frame });
		expect(
			historyResultCommand('cmd-1', frame, {
				ok: true,
				messages: [{ role: 'user', content: 'Remember cedar.' }],
			}),
		).toEqual({
			cmd: 'history_result',
			id: 'cmd-1',
			sessionId: 'sess-1',
			requestId: 'req-1',
			ok: true,
			messages: [{ role: 'user', content: 'Remember cedar.' }],
		});
	});

	it('refuses a request that names no chat', () => {
		expect(decodeControlFrame({ ...frame, sessionId: '' })).toEqual({
			ok: false,
			error: 'bridge.history_request: `requestId` and `sessionId` must not be empty',
		});
	});
});

describe('platform requests', () => {
	const frame = {
		type: 'bridge.platform_request',
		protocolVersion: BRIDGE_PROTOCOL_VERSION,
		requestId: 'req-1',
		sessionId: 'sess-1',
		runId: 'run-1',
	} as const;

	it('decodes a tool call with its run and answers it with its ids', () => {
		const decoded = decodeControlFrame({
			...frame,
			tool: 'jobs_save',
			input: { name: 'Docs after merge', when: null },
		});
		expect(decoded).toEqual({
			ok: true,
			value: { ...frame, tool: 'jobs_save', input: { name: 'Docs after merge', when: null } },
		});
		const request = { ...frame, tool: 'jobs_list', input: {} } as const;
		expect(platformResultCommand('cmd-1', request, { ok: true, text: '[]' })).toEqual({
			cmd: 'platform_result',
			id: 'cmd-1',
			sessionId: 'sess-1',
			requestId: 'req-1',
			ok: true,
			text: '[]',
		});
	});

	it('refuses a tool it does not know, a missing input or a request with no run', () => {
		expect(decodeControlFrame({ ...frame, tool: 'jobs_delete', input: {} })).toEqual({
			ok: false,
			error: 'bridge.platform_request: unknown tool `jobs_delete`',
		});
		expect(decodeControlFrame({ ...frame, tool: 'jobs_list' })).toEqual({
			ok: false,
			error: 'bridge.platform_request: field `input` must be an object',
		});
		expect(decodeControlFrame({ ...frame, runId: '', tool: 'jobs_list', input: {} })).toEqual({
			ok: false,
			error: 'bridge.platform_request: `requestId`, `sessionId` and `runId` must not be empty',
		});
	});
});

describe('control frames', () => {
	it('decodes every variant and refuses malformed ones', () => {
		const ready = decodeControlFrame({
			type: 'bridge.ready',
			contractName: BRIDGE_CONTRACT_NAME,
			protocolVersion: BRIDGE_PROTOCOL_VERSION,
			pid: 4,
			capabilities: [capability({ version: null })],
			heartbeatIntervalMs: 1000,
		});
		expect(ready.ok).toBe(true);
		expect(
			decodeControlFrame({
				type: 'bridge.command_ack',
				protocolVersion: 12,
				id: 'x',
				accepted: false,
				error: 'e',
			}),
		).toEqual({
			ok: true,
			value: {
				type: 'bridge.command_ack',
				protocolVersion: 12,
				id: 'x',
				accepted: false,
				error: 'e',
			},
		});
		expect(
			decodeControlFrame({
				type: 'bridge.protocol_error',
				protocolVersion: 12,
				code: 'BAD',
				message: 'm',
				runId: 'r',
			}),
		).toEqual({
			ok: true,
			value: {
				type: 'bridge.protocol_error',
				protocolVersion: 12,
				code: 'BAD',
				message: 'm',
				runId: 'r',
			},
		});
		expect(decodeControlFrame({ type: 'bridge.heartbeat', protocolVersion: 12 })).toMatchObject({
			ok: false,
		});
		expect(decodeControlFrame({ type: 'bridge.other' })).toMatchObject({
			ok: false,
			error: 'unknown variant `bridge.other`',
		});
		expect(
			decodeControlFrame({
				type: 'bridge.ready',
				contractName: 'c',
				protocolVersion: 12,
				pid: 1,
				capabilities: [{ ...capability(), state: 'weird' }],
				heartbeatIntervalMs: 1000,
			}),
		).toMatchObject({ ok: false, error: 'capabilities[0]: unknown state `weird`' });
		expect(
			decodeControlFrame({
				type: 'bridge.capabilities',
				protocolVersion: 12,
				capabilities: [{ ...capability(), models: [{ ...model('opus'), efforts: ['ultra'] }] }],
			}),
		).toMatchObject({
			ok: false,
			error: 'capabilities[0].models[0]: field `efforts` must hold only known reasoning efforts',
		});
		expect(
			decodeControlFrame({
				type: 'bridge.capabilities',
				protocolVersion: 12,
				capabilities: [{ ...capability(), account: { email: 7 } }],
			}),
		).toMatchObject({
			ok: false,
			error: 'capabilities[0].account: field `email` must be a string',
		});
	});

	it('names a contract mismatch and picks the ack budget per command', () => {
		expect(
			readyFrameMismatch({
				contractName: BRIDGE_CONTRACT_NAME,
				protocolVersion: BRIDGE_PROTOCOL_VERSION,
				heartbeatIntervalMs: 1000,
			}),
		).toBeNull();
		expect(
			readyFrameMismatch({ contractName: 'other', protocolVersion: 3, heartbeatIntervalMs: 1000 }),
		).toBe(
			`PROTOCOL_MISMATCH: expected ${BRIDGE_CONTRACT_NAME} v${BRIDGE_PROTOCOL_VERSION} heartbeat=1000ms, got other v3 heartbeat=1000ms`,
		);
		expect(
			commandAcknowledgementTimeoutMs({
				cmd: 'start_session',
				id: 'a',
				sessionId: 's',
				workstreamId: 'w',
			}),
		).toBe(BRIDGE_START_SESSION_ACK_TIMEOUT_MS);
		expect(
			commandAcknowledgementTimeoutMs({ cmd: 'cancel_run', id: 'a', sessionId: 's', runId: 'r' }),
		).toBe(BRIDGE_COMMAND_ACK_TIMEOUT_MS);
	});
});

describe('validateCapabilities', () => {
	it('accepts a consistent ready agent', () => {
		expect(() => validateCapabilities([capability()])).not.toThrow();
	});

	it('rejects an inconsistent or absent agent capability', () => {
		expect(() => validateCapabilities([])).toThrow('capabilities must contain at least one entry');
		expect(() => validateCapabilities([capability(), capability()])).toThrow(
			'capabilities must contain exactly one entry',
		);
		expect(() => validateCapabilities([capability({ authenticated: null })])).toThrow(
			'a ready agent must report authenticated=true',
		);
		expect(() => validateCapabilities([capability({ defaultModel: 'x' })])).toThrow(
			'the agent default model `x` is absent from its models',
		);
		expect(() =>
			validateCapabilities([capability({ models: [model('a'), model('a')], defaultModel: 'a' })]),
		).toThrow('the agent reported duplicate model `a`');
		expect(() =>
			validateCapabilities([capability({ models: [model(' a')], defaultModel: '' })]),
		).toThrow('the agent reported an empty or whitespace-padded model id');
		expect(() =>
			validateCapabilities([capability({ state: 'needs_auth', authenticated: false })]),
		).toThrow('a needs_auth agent cannot report a signed-in account');
		expect(() =>
			validateCapabilities([
				capability({ state: 'needs_auth', authenticated: true, account: null }),
			]),
		).toThrow('a needs_auth agent must report installed=true and authenticated=false');
		expect(() =>
			validateCapabilities([
				capability({ state: 'missing', installed: false, authenticated: null, account: null }),
			]),
		).not.toThrow();
		expect(() =>
			validateCapabilities([
				capability({
					state: 'unknown',
					authenticated: null,
					account: null,
					models: [],
					defaultModel: '',
				}),
			]),
		).not.toThrow();
		expect(() =>
			validateCapabilities([capability({ state: 'unknown', authenticated: true, account: null })]),
		).toThrow('an unknown agent must report authenticated=null');
	});
});
