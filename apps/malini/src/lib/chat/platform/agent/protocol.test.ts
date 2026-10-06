import { describe, expect, it } from 'vitest';
import {
	BRIDGE_COMMAND_ACK_TIMEOUT_MS,
	BRIDGE_CONTRACT_NAME,
	BRIDGE_PROTOCOL_VERSION,
	BRIDGE_START_SESSION_ACK_TIMEOUT_MS,
	commandAcknowledgementTimeoutMs,
	decodeBridgeEvent,
	decodeControlFrame,
	eventRunId,
	eventSessionId,
	eventToPersistable,
	isEphemeralEvent,
	readyFrameMismatch,
	validateCapabilities,
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
		expect(
			decode({ type: 'run.completed', runId: 'r', summary: 's', providerCursor: 'uuid-1' }),
		).toEqual({ type: 'run.completed', runId: 'r', summary: 's', providerCursor: 'uuid-1' });
		expect(decode({ type: 'run.failed', runId: 'r', error: 'e', providerCursor: null })).toEqual({
			type: 'run.failed',
			runId: 'r',
			error: 'e',
		});
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
		expect(
			decode({ type: 'tool.completed', runId: 'r', name: 'n', output: { a: 1 }, isError: true }),
		).toEqual({
			type: 'tool.completed',
			runId: 'r',
			name: 'n',
			output: { a: 1 },
			isError: true,
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
			[{ type: 'usage.updated', runId: 'r', interim: true }, true],
			[{ type: 'usage.updated', runId: 'r', interim: false }, false],
			[{ type: 'usage.updated', runId: 'r' }, false],
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
