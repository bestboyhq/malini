import { describe, expect, it } from 'vitest';
import {
	bridgeCapabilitiesFrame,
	bridgeCommandAckFrame,
	bridgeHeartbeatFrame,
	bridgeProtocolErrorFrame,
	bridgeReadyFrame,
	parseCommandLine,
	type AgentCommand,
	type ProviderCapability,
} from '../protocol';
import {
	BRIDGE_COMMAND_NAMES,
	BRIDGE_CONTRACT_NAME,
	BRIDGE_CONTROL_TYPES,
	BRIDGE_EVENT_TYPES,
	BRIDGE_HEARTBEAT_INTERVAL_MS,
	BRIDGE_MAX_FRAME_BYTES,
	BRIDGE_PROTOCOL_VERSION,
} from '../generated/protocol-contract';

describe('protocol: parseCommandLine', () => {
	describe('well-formed commands (positive)', () => {
		it('parses start_session with required fields', () => {
			const r = parseCommandLine(
				'{"cmd":"start_session","id":"cmd-start","sessionId":"s1","workstreamId":"w1"}',
			);
			expect(r.ok).toBe(true);
			if (r.ok) {
				const cmd: AgentCommand = r.command;
				expect(cmd.cmd).toBe('start_session');
				if (cmd.cmd === 'start_session') {
					expect(cmd.id).toBe('cmd-start');
					expect(cmd.sessionId).toBe('s1');
					expect(cmd.workstreamId).toBe('w1');
					expect(cmd.model).toBeUndefined();
				}
			}
		});

		it('parses start_session with optional model', () => {
			const r = parseCommandLine(
				'{"cmd":"start_session","id":"cmd-start","sessionId":"s1","workstreamId":"w1","model":"opus[1m]","providerSessionId":"c0a96268-cd2e-40f9-88f1-f8c53c9cbbc7"}',
			);
			expect(r.ok).toBe(true);
			if (r.ok && r.command.cmd === 'start_session') {
				expect(r.command.model).toBe('opus[1m]');
				expect(r.command.providerSessionId).toBe('c0a96268-cd2e-40f9-88f1-f8c53c9cbbc7');
			}
		});

		it('parses start_session with optional worktreePath', () => {
			const r = parseCommandLine(
				'{"cmd":"start_session","id":"cmd-start","sessionId":"s1","workstreamId":"w1","worktreePath":"/tmp/app-ws"}',
			);
			expect(r.ok).toBe(true);
			if (r.ok && r.command.cmd === 'start_session') {
				expect(r.command.worktreePath).toBe('/tmp/app-ws');
			}
		});

		it('drops the auth mode and provider environment older apps still send', () => {
			const r = parseCommandLine(
				'{"cmd":"start_session","id":"cmd-start","sessionId":"s1","workstreamId":"w1","authMode":"subscription","providerEnv":{"ANTHROPIC_API_KEY":"sk-ant-test"}}',
			);
			expect(r).toEqual({
				ok: true,
				command: { cmd: 'start_session', id: 'cmd-start', sessionId: 's1', workstreamId: 'w1' },
			});
		});

		it('parses bounded vendor-neutral conversation history', () => {
			const result = parseCommandLine(
				JSON.stringify({
					cmd: 'start_session',
					id: 'cmd-history',
					sessionId: 's1',
					workstreamId: 'w1',
					conversationHistory: [
						{ role: 'user', content: 'Remember cedar.' },
						{
							role: 'assistant',
							content: 'I will remember cedar.',
							reasoningContent: 'The user asked me to retain cedar.',
						},
					],
				}),
			);
			expect(result.ok).toBe(true);
			if (result.ok && result.command.cmd === 'start_session') {
				expect(result.command.conversationHistory).toEqual([
					{ role: 'user', content: 'Remember cedar.' },
					{
						role: 'assistant',
						content: 'I will remember cedar.',
						reasoningContent: 'The user asked me to retain cedar.',
					},
				]);
			}
		});

		it('parses send_prompt', () => {
			const r = parseCommandLine(
				'{"cmd":"send_prompt","id":"cmd-send","sessionId":"s1","runId":"r1","prompt":"hello"}',
			);
			expect(r.ok).toBe(true);
			if (r.ok && r.command.cmd === 'send_prompt') {
				expect(r.command.prompt).toBe('hello');
			}
		});

		it('parses the message a prompt rewinds the Claude session to', () => {
			const r = parseCommandLine(
				'{"cmd":"send_prompt","id":"cmd-send","sessionId":"s1","runId":"r1","prompt":"retry","resumeAt":"14372fe3-16a6-4ab1-8c70-ee97865c9a65"}',
			);
			expect(r).toEqual({
				ok: true,
				command: {
					cmd: 'send_prompt',
					id: 'cmd-send',
					sessionId: 's1',
					runId: 'r1',
					prompt: 'retry',
					resumeAt: '14372fe3-16a6-4ab1-8c70-ee97865c9a65',
				},
			});
		});

		it('rejects a rewind point that is not a message id', () => {
			for (const resumeAt of ['', 42, null]) {
				const result = parseCommandLine(
					JSON.stringify({
						cmd: 'send_prompt',
						id: 'cmd-send',
						sessionId: 's1',
						runId: 'r1',
						prompt: 'retry',
						resumeAt,
					}),
				);
				expect(result).toMatchObject({
					ok: false,
					code: 'INVALID_PAYLOAD',
					message: 'send_prompt: resumeAt, when present, must be a string',
				});
			}
		});

		it('parses a typed per-prompt effort and mode profile', () => {
			const r = parseCommandLine(
				'{"cmd":"send_prompt","id":"cmd-send","sessionId":"s1","runId":"r1","prompt":"hello","profile":{"effort":"high","mode":"plan","access":"auto"}}',
			);
			expect(r.ok).toBe(true);
			if (r.ok && r.command.cmd === 'send_prompt') {
				expect(r.command.profile).toEqual({ effort: 'high', mode: 'plan', access: 'auto' });
			}
		});

		it('rejects an unknown profile value at the stdio boundary', () => {
			const r = parseCommandLine(
				'{"cmd":"send_prompt","id":"cmd-send","sessionId":"s1","runId":"r1","prompt":"hello","profile":{"effort":"unlimited","mode":"plan"}}',
			);
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.code).toBe('INVALID_PAYLOAD');
		});

		it('parses cancel_run', () => {
			const r = parseCommandLine(
				'{"cmd":"cancel_run","id":"cmd-cancel","sessionId":"s1","runId":"r1"}',
			);
			expect(r.ok).toBe(true);
		});

		it('parses a session-scoped close barrier', () => {
			const result = parseCommandLine('{"cmd":"close_session","id":"cmd-close","sessionId":"s1"}');
			expect(result).toEqual({
				ok: true,
				command: { cmd: 'close_session', id: 'cmd-close', sessionId: 's1' },
			});
		});

		it('normalizes legacy approve/omitted scope to allow/once', () => {
			const r = parseCommandLine(
				'{"cmd":"approve","id":"cmd-approve","sessionId":"s1","runId":"r1","approvalId":"a1","decision":"approve"}',
			);
			expect(r).toEqual({
				ok: true,
				command: {
					cmd: 'approve',
					id: 'cmd-approve',
					sessionId: 's1',
					runId: 'r1',
					approvalId: 'a1',
					decision: 'allow',
					scope: 'once',
				},
			});
		});

		it("parses approve with decision='deny'", () => {
			const r = parseCommandLine(
				'{"cmd":"approve","id":"cmd-approve","sessionId":"s1","runId":"r1","approvalId":"a1","decision":"deny","scope":"workstream"}',
			);
			expect(r.ok).toBe(true);
			if (r.ok && r.command.cmd === 'approve') {
				expect(r.command.scope).toBe('workstream');
			}
		});

		it('parses structured question answers with full correlation', () => {
			const result = parseCommandLine(
				'{"cmd":"answer_question","id":"answer-1","sessionId":"s1","runId":"r1","questionId":"request-1","answers":[{"questionId":"request-1:0","values":["Vitest"]}]}',
			);
			expect(result).toEqual({
				ok: true,
				command: {
					cmd: 'answer_question',
					id: 'answer-1',
					sessionId: 's1',
					runId: 'r1',
					questionId: 'request-1',
					answers: [{ questionId: 'request-1:0', values: ['Vitest'] }],
				},
			});
		});

		it('parses a capability refresh command with only its correlation id', () => {
			const result = parseCommandLine('{"cmd":"refresh_capabilities","id":"refresh-1"}');
			expect(result).toEqual({
				ok: true,
				command: { cmd: 'refresh_capabilities', id: 'refresh-1' },
			});
		});

		it('parses a session-scoped MCP status refresh command', () => {
			const result = parseCommandLine(
				'{"cmd":"refresh_mcp_status","id":"refresh-mcp-1","sessionId":"session-1","runId":"mcp-refresh-1"}',
			);
			expect(result).toEqual({
				ok: true,
				command: {
					cmd: 'refresh_mcp_status',
					id: 'refresh-mcp-1',
					sessionId: 'session-1',
					runId: 'mcp-refresh-1',
				},
			});
		});

		it('parses suggest_title and rejects an empty prompt', () => {
			expect(
				parseCommandLine('{"cmd":"suggest_title","id":"t1","prompt":"Version the bundle"}'),
			).toEqual({
				ok: true,
				command: { cmd: 'suggest_title', id: 't1', prompt: 'Version the bundle' },
			});
			expect(parseCommandLine('{"cmd":"suggest_title","id":"t2","prompt":"  "}').ok).toBe(false);
		});

		it("rejects approve with decision other than 'allow'/'deny'", () => {
			const r = parseCommandLine(
				'{"cmd":"approve","id":"cmd-approve","sessionId":"s1","runId":"r1","approvalId":"a1","decision":"maybe"}',
			);
			expect(r.ok).toBe(false);
		});

		it('generated contract owns every command, event, and control discriminator', () => {
			expect(BRIDGE_COMMAND_NAMES).toEqual([
				'start_session',
				'send_prompt',
				'cancel_run',
				'close_session',
				'approve',
				'answer_question',
				'refresh_capabilities',
				'refresh_mcp_status',
				'suggest_title',
			]);
			expect(BRIDGE_EVENT_TYPES).toHaveLength(21);
			expect(BRIDGE_CONTROL_TYPES).toEqual([
				'bridge.ready',
				'bridge.capabilities',
				'bridge.heartbeat',
				'bridge.command_ack',
				'bridge.protocol_error',
				'bridge.title',
			]);
		});

		it('constructs versioned control frames from the generated contract', () => {
			const capability: ProviderCapability = {
				state: 'ready',
				installed: true,
				authenticated: true,
				version: '2.1.196',
				account: { email: 'ada@example.com', plan: 'Claude Max' },
				models: [
					{
						id: 'default',
						label: 'Default',
						description: 'Opus 4.8 with 1M context · Best for everyday, complex tasks',
						efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
					},
				],
				defaultModel: 'default',
				message: 'Signed in as ada@example.com',
			};
			expect(bridgeReadyFrame([capability])).toMatchObject({
				type: 'bridge.ready',
				contractName: BRIDGE_CONTRACT_NAME,
				protocolVersion: BRIDGE_PROTOCOL_VERSION,
				capabilities: [capability],
				heartbeatIntervalMs: BRIDGE_HEARTBEAT_INTERVAL_MS,
			});
			expect(bridgeCapabilitiesFrame([capability])).toEqual({
				type: 'bridge.capabilities',
				protocolVersion: BRIDGE_PROTOCOL_VERSION,
				capabilities: [capability],
			});
			expect(bridgeHeartbeatFrame(42)).toEqual({
				type: 'bridge.heartbeat',
				protocolVersion: BRIDGE_PROTOCOL_VERSION,
				ts: 42,
			});
			expect(bridgeCommandAckFrame('c1')).toMatchObject({
				type: 'bridge.command_ack',
				id: 'c1',
				accepted: true,
			});
		});
	});

	describe('malformed input rejection', () => {
		it('rejects malformed JSON with BAD_FRAME', () => {
			const r = parseCommandLine('{not valid');
			expect(r.ok).toBe(false);
			if (!r.ok) {
				expect(r.code).toBe('BAD_FRAME');
				expect(r.message).toMatch(/malformed JSON/);
			}
		});

		it('rejects empty line with BAD_FRAME', () => {
			const r = parseCommandLine('');
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.code).toBe('BAD_FRAME');
		});

		it('rejects whitespace-only line with BAD_FRAME', () => {
			const r = parseCommandLine('   \t  ');
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.code).toBe('BAD_FRAME');
		});

		it('rejects top-level non-object (array) with BAD_FRAME', () => {
			const r = parseCommandLine('[1,2,3]');
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.code).toBe('BAD_FRAME');
		});

		it('rejects top-level non-object (number) with BAD_FRAME', () => {
			const r = parseCommandLine('42');
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.code).toBe('BAD_FRAME');
		});

		it('rejects top-level null with BAD_FRAME', () => {
			const r = parseCommandLine('null');
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.code).toBe('BAD_FRAME');
		});
	});

	describe('unknown command rejection', () => {
		it('rejects unknown command with UNKNOWN_COMMAND', () => {
			const r = parseCommandLine('{"cmd":"wat","foo":"bar"}');
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.code).toBe('UNKNOWN_COMMAND');
		});

		it('rejects missing cmd field with UNKNOWN_COMMAND', () => {
			const r = parseCommandLine('{"foo":"bar"}');
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.code).toBe('UNKNOWN_COMMAND');
		});

		it('rejects non-string cmd field with UNKNOWN_COMMAND', () => {
			const r = parseCommandLine('{"cmd":42}');
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.code).toBe('UNKNOWN_COMMAND');
		});
	});

	describe('missing required field per variant', () => {
		it('rejects a command without a correlation id', () => {
			const r = parseCommandLine('{"cmd":"start_session","sessionId":"s","workstreamId":"w"}');
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.message).toMatch(/id required/);
		});

		it('start_session missing sessionId -> INVALID_PAYLOAD', () => {
			const r = parseCommandLine('{"cmd":"start_session","id":"cmd-start","workstreamId":"w"}');
			expect(r.ok).toBe(false);
			if (!r.ok) {
				expect(r.code).toBe('INVALID_PAYLOAD');
				expect(r.message).toMatch(/sessionId/);
			}
		});

		it('start_session missing workstreamId -> INVALID_PAYLOAD', () => {
			const r = parseCommandLine('{"cmd":"start_session","id":"cmd-start","sessionId":"s"}');
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.code).toBe('INVALID_PAYLOAD');
		});

		it('start_session model field of wrong type -> INVALID_PAYLOAD', () => {
			const r = parseCommandLine(
				'{"cmd":"start_session","id":"cmd-start","sessionId":"s","workstreamId":"w","model":42}',
			);
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.code).toBe('INVALID_PAYLOAD');
		});

		it('start_session worktreePath field of wrong type -> INVALID_PAYLOAD', () => {
			const r = parseCommandLine(
				'{"cmd":"start_session","id":"cmd-start","sessionId":"s","workstreamId":"w","worktreePath":42}',
			);
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.code).toBe('INVALID_PAYLOAD');
		});

		it('strictly rejects malformed or provider-specific conversation history', () => {
			for (const conversationHistory of [
				'not-an-array',
				[null],
				[{ role: 'tool', content: 'secret output' }],
				[{ role: 'assistant', content: 'answer', toolCallId: 'provider-specific' }],
				[{ role: 'user', content: '' }],
				[{ role: 'assistant', content: 42 }],
			]) {
				const result = parseCommandLine(
					JSON.stringify({
						cmd: 'start_session',
						id: 'cmd-history-invalid',
						sessionId: 's',
						workstreamId: 'w',
						conversationHistory,
					}),
				);
				expect(result.ok).toBe(false);
				if (!result.ok) expect(result.code).toBe('INVALID_PAYLOAD');
			}
		});

		it('rejects reasoningContent on user conversation history messages', () => {
			const result = parseCommandLine(
				JSON.stringify({
					cmd: 'start_session',
					id: 'cmd-history-user-reasoning',
					sessionId: 's',
					workstreamId: 'w',
					conversationHistory: [
						{ role: 'user', content: 'question', reasoningContent: 'not allowed' },
					],
				}),
			);
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.code).toBe('INVALID_PAYLOAD');
				expect(result.message).toContain('only valid for assistant messages');
			}
		});

		it('bounds restored conversation history by UTF-8 bytes, not JavaScript string length', () => {
			const result = parseCommandLine(
				JSON.stringify({
					cmd: 'start_session',
					id: 'cmd-history-multibyte',
					sessionId: 's',
					workstreamId: 'w',
					conversationHistory: [{ role: 'user', content: '🦀'.repeat(70_000) }],
				}),
			);
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.code).toBe('INVALID_PAYLOAD');
				expect(result.message).toContain('UTF-8 bytes');
			}
		});

		it('includes assistant reasoningContent in the restored history UTF-8 byte bound', () => {
			const result = parseCommandLine(
				JSON.stringify({
					cmd: 'start_session',
					id: 'cmd-history-reasoning-multibyte',
					sessionId: 's',
					workstreamId: 'w',
					conversationHistory: [
						{
							role: 'assistant',
							content: 'answer',
							reasoningContent: '🦀'.repeat(70_000),
						},
					],
				}),
			);
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.code).toBe('INVALID_PAYLOAD');
				expect(result.message).toContain('UTF-8 bytes');
			}
		});

		it('send_prompt missing sessionId -> INVALID_PAYLOAD', () => {
			const r = parseCommandLine('{"cmd":"send_prompt","id":"cmd-send","runId":"r","prompt":"hi"}');
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.code).toBe('INVALID_PAYLOAD');
		});

		it('send_prompt missing runId -> INVALID_PAYLOAD', () => {
			const r = parseCommandLine(
				'{"cmd":"send_prompt","id":"cmd-send","sessionId":"s","prompt":"hi"}',
			);
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.code).toBe('INVALID_PAYLOAD');
		});

		it('send_prompt missing prompt -> INVALID_PAYLOAD', () => {
			const r = parseCommandLine(
				'{"cmd":"send_prompt","id":"cmd-send","sessionId":"s","runId":"r"}',
			);
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.code).toBe('INVALID_PAYLOAD');
		});

		it('cancel_run missing runId -> INVALID_PAYLOAD', () => {
			const r = parseCommandLine('{"cmd":"cancel_run","id":"cmd-cancel","sessionId":"s"}');
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.code).toBe('INVALID_PAYLOAD');
		});

		it('cancel_run missing sessionId -> INVALID_PAYLOAD', () => {
			const r = parseCommandLine('{"cmd":"cancel_run","id":"cmd-cancel","runId":"r"}');
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.code).toBe('INVALID_PAYLOAD');
		});

		it('close_session missing sessionId -> INVALID_PAYLOAD', () => {
			const result = parseCommandLine('{"cmd":"close_session","id":"cmd-close"}');
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.code).toBe('INVALID_PAYLOAD');
		});

		it('approve missing approvalId -> INVALID_PAYLOAD', () => {
			const r = parseCommandLine(
				'{"cmd":"approve","id":"cmd-approve","sessionId":"s","runId":"r","decision":"allow"}',
			);
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.code).toBe('INVALID_PAYLOAD');
		});

		it('approve missing decision -> INVALID_PAYLOAD', () => {
			const r = parseCommandLine(
				'{"cmd":"approve","id":"cmd-approve","sessionId":"s","runId":"r","approvalId":"a"}',
			);
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.code).toBe('INVALID_PAYLOAD');
		});

		it('refresh_capabilities missing id -> INVALID_PAYLOAD', () => {
			const result = parseCommandLine('{"cmd":"refresh_capabilities"}');
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.code).toBe('INVALID_PAYLOAD');
		});
	});

	it('rejects a frame larger than the generated byte limit before JSON parsing', () => {
		const raw = 'x'.repeat(BRIDGE_MAX_FRAME_BYTES + 1);
		const result = parseCommandLine(raw);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('FRAME_TOO_LARGE');
			expect(bridgeProtocolErrorFrame(result)).toMatchObject({
				type: 'bridge.protocol_error',
				code: 'FRAME_TOO_LARGE',
			});
		}
	});

	describe('extra fields (forward compatibility)', () => {
		it('accepts unknown extra keys at top level', () => {
			const r = parseCommandLine(
				'{"cmd":"start_session","id":"cmd-start","sessionId":"s","workstreamId":"w","future":"v2-token"}',
			);
			expect(r.ok).toBe(true);
		});
	});
});
