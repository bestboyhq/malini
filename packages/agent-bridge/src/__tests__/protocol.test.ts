import { describe, expect, it } from 'vitest';
import {
	bridgeBrowserRequestFrame,
	bridgePlatformRequestFrame,
	bridgeCapabilitiesFrame,
	bridgeCommandAckFrame,
	bridgeHeartbeatFrame,
	bridgeMcpServerFrame,
	bridgeMcpServersFrame,
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
	BRIDGE_PLATFORM_TOOLS,
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

		it('parses bounded conversation history', () => {
			const result = parseCommandLine(
				JSON.stringify({
					cmd: 'start_session',
					id: 'cmd-history',
					sessionId: 's1',
					workstreamId: 'w1',
					conversationHistory: [
						{ role: 'user', content: 'Remember cedar.' },
						{ role: 'assistant', content: 'I will remember cedar.' },
					],
				}),
			);
			expect(result.ok).toBe(true);
			if (result.ok && result.command.cmd === 'start_session') {
				expect(result.command.conversationHistory).toEqual([
					{ role: 'user', content: 'Remember cedar.' },
					{ role: 'assistant', content: 'I will remember cedar.' },
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

		it('parses the report resolution of a profile and rejects an unknown one', () => {
			const send = (report: string): ReturnType<typeof parseCommandLine> =>
				parseCommandLine(
					`{"cmd":"send_prompt","id":"cmd-send","sessionId":"s1","runId":"r1","prompt":"hello","profile":{"effort":"high","mode":"agent","access":"auto","report":"${report}"}}`,
				);
			expect(send('low')).toMatchObject({
				ok: true,
				command: { profile: { effort: 'high', mode: 'agent', access: 'auto', report: 'low' } },
			});
			expect(send('verbose')).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' });
		});

		it('parses a browser result and rejects one main could not have sent', () => {
			expect(
				parseCommandLine(
					'{"cmd":"browser_result","id":"b1","sessionId":"s1","requestId":"q1","ok":true,"text":"Saved","imagePath":"/w/.malini/sandbox/screenshots/x.jpg"}',
				),
			).toEqual({
				ok: true,
				command: {
					cmd: 'browser_result',
					id: 'b1',
					sessionId: 's1',
					requestId: 'q1',
					ok: true,
					text: 'Saved',
					imagePath: '/w/.malini/sandbox/screenshots/x.jpg',
				},
			});
			expect(
				parseCommandLine(
					'{"cmd":"browser_result","id":"b2","sessionId":"s1","requestId":"q1","ok":false,"error":"Nothing is open"}',
				),
			).toMatchObject({ ok: true, command: { ok: false, error: 'Nothing is open' } });
			for (const invalid of [
				'{"cmd":"browser_result","id":"b3","sessionId":"s1","requestId":"q1"}',
				'{"cmd":"browser_result","id":"b4","sessionId":"s1","ok":true}',
				'{"cmd":"browser_result","id":"b5","sessionId":"s1","requestId":"q1","ok":true,"imagePath":"x.jpg"}',
				'{"cmd":"browser_result","id":"b6","sessionId":"s1","requestId":"q1","ok":false,"error":42}',
			]) {
				expect(parseCommandLine(invalid)).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' });
			}
		});

		it('parses a platform result and rejects one main could not have sent', () => {
			expect(
				parseCommandLine(
					'{"cmd":"platform_result","id":"p1","sessionId":"s1","requestId":"q1","ok":true,"text":"[]"}',
				),
			).toEqual({
				ok: true,
				command: {
					cmd: 'platform_result',
					id: 'p1',
					sessionId: 's1',
					requestId: 'q1',
					ok: true,
					text: '[]',
				},
			});
			expect(
				parseCommandLine(
					'{"cmd":"platform_result","id":"p2","sessionId":"s1","requestId":"q1","ok":false,"error":"No job is named x."}',
				),
			).toMatchObject({ ok: true, command: { ok: false, error: 'No job is named x.' } });
			for (const invalid of [
				'{"cmd":"platform_result","id":"p3","sessionId":"s1","requestId":"q1"}',
				'{"cmd":"platform_result","id":"p4","sessionId":"","requestId":"q1","ok":true}',
				'{"cmd":"platform_result","id":"p5","sessionId":"s1","requestId":"q1","ok":true,"text":7}',
				'{"cmd":"platform_result","sessionId":"s1","requestId":"q1","ok":true}',
			]) {
				expect(parseCommandLine(invalid)).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' });
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

		it('parses an approval for everywhere that carries the input the user reviewed', () => {
			const r = parseCommandLine(
				JSON.stringify({
					cmd: 'approve',
					id: 'cmd-approve',
					sessionId: 's1',
					runId: 'r1',
					approvalId: 'a1',
					decision: 'allow',
					scope: 'everywhere',
					updatedInput: { id: 'job-1', instructions: 'Reviewed' },
				}),
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
					scope: 'everywhere',
					updatedInput: { id: 'job-1', instructions: 'Reviewed' },
				},
			});
		});

		it('rejects a reviewed input on a deny or one that is not an object', () => {
			const approve = (fields: Record<string, unknown>) =>
				parseCommandLine(
					JSON.stringify({
						cmd: 'approve',
						id: 'cmd-approve',
						sessionId: 's1',
						runId: 'r1',
						approvalId: 'a1',
						...fields,
					}),
				);
			expect(approve({ decision: 'deny', updatedInput: { id: 'job-1' } }).ok).toBe(false);
			expect(approve({ decision: 'allow', updatedInput: ['job-1'] }).ok).toBe(false);
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

		it('parses a session status refresh command', () => {
			const result = parseCommandLine(
				'{"cmd":"refresh_session_status","id":"refresh-status-1","sessionId":"session-1"}',
			);
			expect(result).toEqual({
				ok: true,
				command: { cmd: 'refresh_session_status', id: 'refresh-status-1', sessionId: 'session-1' },
			});
		});

		it('parses MCP server commands for a chat or a folder, never both or neither', () => {
			expect(
				parseCommandLine(
					'{"cmd":"authorize_mcp_server","id":"mcp-1","sessionId":"session-1","serverName":"linear"}',
				),
			).toEqual({
				ok: true,
				command: {
					cmd: 'authorize_mcp_server',
					id: 'mcp-1',
					sessionId: 'session-1',
					serverName: 'linear',
				},
			});
			expect(
				parseCommandLine(
					'{"cmd":"reconnect_mcp_server","id":"mcp-2","cwd":"/repo","serverName":"linear"}',
				),
			).toEqual({
				ok: true,
				command: { cmd: 'reconnect_mcp_server', id: 'mcp-2', cwd: '/repo', serverName: 'linear' },
			});
			for (const target of [
				'"sessionId":"session-1"',
				'"sessionId":"session-1","cwd":"/repo","serverName":"linear"',
				'"serverName":"linear"',
				'"sessionId":"","serverName":"linear"',
				'"cwd":"repo","serverName":"linear"',
			]) {
				expect(
					parseCommandLine(`{"cmd":"authorize_mcp_server","id":"mcp-3",${target}}`),
				).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD', id: 'mcp-3' });
			}
		});

		it('parses list_mcp_servers for an absolute folder and rejects any other', () => {
			expect(parseCommandLine('{"cmd":"list_mcp_servers","id":"m1","cwd":"/repo"}')).toEqual({
				ok: true,
				command: { cmd: 'list_mcp_servers', id: 'm1', cwd: '/repo' },
			});
			expect(parseCommandLine('{"cmd":"list_mcp_servers","id":"m2","cwd":"repo"}')).toMatchObject({
				ok: false,
				code: 'INVALID_PAYLOAD',
			});
		});

		it('parses a stop_task command and rejects one without a task', () => {
			expect(
				parseCommandLine(
					'{"cmd":"stop_task","id":"stop-1","sessionId":"session-1","runId":"run-1","taskId":"b1"}',
				),
			).toEqual({
				ok: true,
				command: {
					cmd: 'stop_task',
					id: 'stop-1',
					sessionId: 'session-1',
					runId: 'run-1',
					taskId: 'b1',
				},
			});
			expect(
				parseCommandLine(
					'{"cmd":"stop_task","id":"stop-2","sessionId":"session-1","runId":"run-1"}',
				).ok,
			).toBe(false);
		});

		it('parses suggest_title with the naming job and rejects a missing part', () => {
			expect(
				parseCommandLine(
					'{"cmd":"suggest_title","id":"t1","prompt":"Version the bundle","instructions":"Name it.","model":"haiku"}',
				),
			).toEqual({
				ok: true,
				command: {
					cmd: 'suggest_title',
					id: 't1',
					prompt: 'Version the bundle',
					instructions: 'Name it.',
					model: 'haiku',
				},
			});
			expect(
				parseCommandLine(
					'{"cmd":"suggest_title","id":"t2","prompt":"  ","instructions":"Name it.","model":"haiku"}',
				).ok,
			).toBe(false);
			expect(
				parseCommandLine('{"cmd":"suggest_title","id":"t3","prompt":"Version it","model":"haiku"}')
					.ok,
			).toBe(false);
			expect(
				parseCommandLine(
					'{"cmd":"suggest_title","id":"t4","prompt":"Version it","instructions":"Name it."}',
				).ok,
			).toBe(false);
		});

		it('parses list_skills for an absolute folder and rejects any other', () => {
			expect(parseCommandLine('{"cmd":"list_skills","id":"k1","cwd":"/repo"}')).toEqual({
				ok: true,
				command: { cmd: 'list_skills', id: 'k1', cwd: '/repo' },
			});
			expect(parseCommandLine('{"cmd":"list_skills","id":"k2","cwd":"repo"}').ok).toBe(false);
			expect(parseCommandLine('{"cmd":"list_skills","id":"k3"}').ok).toBe(false);
		});

		it('parses the turned-off skills and plugins list_skills should still list', () => {
			expect(
				parseCommandLine(
					'{"cmd":"list_skills","id":"k1","cwd":"/repo","turnedOff":{"skills":["humanizer"],"plugins":["caveman@caveman"]}}',
				),
			).toEqual({
				ok: true,
				command: {
					cmd: 'list_skills',
					id: 'k1',
					cwd: '/repo',
					turnedOff: { skills: ['humanizer'], plugins: ['caveman@caveman'] },
				},
			});
			for (const turnedOff of ['[]', '{"skills":["a"]}', '{"skills":[1],"plugins":[]}']) {
				expect(
					parseCommandLine(`{"cmd":"list_skills","id":"k2","cwd":"/repo","turnedOff":${turnedOff}}`)
						.ok,
				).toBe(false);
			}
		});

		it('parses the skills a prompt may use and rejects a list that is not skill names', () => {
			expect(
				parseCommandLine(
					'{"cmd":"send_prompt","id":"p1","sessionId":"s1","runId":"r1","prompt":"hi","skills":["adr","ponytail:ponytail"]}',
				),
			).toEqual({
				ok: true,
				command: {
					cmd: 'send_prompt',
					id: 'p1',
					sessionId: 's1',
					runId: 'r1',
					prompt: 'hi',
					skills: ['adr', 'ponytail:ponytail'],
				},
			});
			expect(
				parseCommandLine(
					'{"cmd":"send_prompt","id":"p2","sessionId":"s1","runId":"r1","prompt":"hi","skills":[]}',
				),
			).toMatchObject({ ok: true, command: { skills: [] } });
			for (const skills of ['"adr"', '[""]', '[1]', JSON.stringify(Array(1001).fill('adr'))]) {
				expect(
					parseCommandLine(
						`{"cmd":"send_prompt","id":"p3","sessionId":"s1","runId":"r1","prompt":"hi","skills":${skills}}`,
					).ok,
				).toBe(false);
			}
		});

		it('parses a prompt that steers the running turn and rejects a steer that is not a boolean', () => {
			const prompt = '"cmd":"send_prompt","id":"p1","sessionId":"s1","runId":"r1","prompt":"hi"';
			expect(parseCommandLine(`{${prompt},"steer":true}`)).toMatchObject({
				ok: true,
				command: { steer: true },
			});
			expect(parseCommandLine(`{${prompt},"steer":false}`)).toMatchObject({ ok: true });
			expect(parseCommandLine(`{${prompt},"steer":"yes"}`).ok).toBe(false);
		});

		it('parses the theme a prompt runs in and rejects one that is not light or dark', () => {
			const prompt = '"cmd":"send_prompt","id":"p1","sessionId":"s1","runId":"r1","prompt":"hi"';
			expect(parseCommandLine(`{${prompt},"theme":"dark"}`)).toMatchObject({
				ok: true,
				command: { theme: 'dark' },
			});
			expect(parseCommandLine(`{${prompt},"theme":"sepia"}`).ok).toBe(false);
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
				'refresh_session_status',
				'authorize_mcp_server',
				'reconnect_mcp_server',
				'list_mcp_servers',
				'cancel_mcp_authorization',
				'stop_task',
				'suggest_title',
				'list_skills',
				'browser_result',
				'platform_result',
			]);
			expect(BRIDGE_EVENT_TYPES).toHaveLength(22);
			expect(BRIDGE_CONTROL_TYPES).toEqual([
				'bridge.ready',
				'bridge.capabilities',
				'bridge.heartbeat',
				'bridge.command_ack',
				'bridge.protocol_error',
				'bridge.title',
				'bridge.skills',
				'bridge.mcp_authorization',
				'bridge.mcp_servers',
				'bridge.mcp_server',
				'bridge.browser_request',
				'bridge.platform_request',
			]);
			expect(BRIDGE_PLATFORM_TOOLS).toEqual([
				'jobs_list',
				'jobs_save',
				'jobs_run',
				'events_list',
				'pull_requests_open_draft',
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
						id: 'opus',
						label: 'Opus',
						description: 'Opus 4.8 with 1M context · Best for everyday, complex tasks',
						efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
					},
				],
				defaultModel: 'opus',
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
			expect(
				bridgeBrowserRequestFrame('q1', 's1', { action: 'open', url: 'http://localhost:5173' }),
			).toEqual({
				type: 'bridge.browser_request',
				protocolVersion: BRIDGE_PROTOCOL_VERSION,
				requestId: 'q1',
				sessionId: 's1',
				action: 'open',
				url: 'http://localhost:5173',
			});
			expect(bridgeBrowserRequestFrame('q2', 's1', { action: 'screenshot' })).toEqual({
				type: 'bridge.browser_request',
				protocolVersion: BRIDGE_PROTOCOL_VERSION,
				requestId: 'q2',
				sessionId: 's1',
				action: 'screenshot',
			});
			expect(
				bridgePlatformRequestFrame('q3', 's1', {
					tool: 'jobs_save',
					input: { name: 'Docs after merge', when: null },
					runId: 'r1',
				}),
			).toEqual({
				type: 'bridge.platform_request',
				protocolVersion: BRIDGE_PROTOCOL_VERSION,
				requestId: 'q3',
				sessionId: 's1',
				runId: 'r1',
				tool: 'jobs_save',
				input: { name: 'Docs after merge', when: null },
			});
			const linear = { name: 'linear', status: 'connected', source: 'user', toolCount: 4 };
			expect(bridgeMcpServersFrame('m1', [linear])).toEqual({
				type: 'bridge.mcp_servers',
				protocolVersion: BRIDGE_PROTOCOL_VERSION,
				id: 'm1',
				servers: [linear],
			});
			expect(bridgeMcpServerFrame(linear)).toEqual({
				type: 'bridge.mcp_server',
				protocolVersion: BRIDGE_PROTOCOL_VERSION,
				server: linear,
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

		it('rejects any field beyond role and content on a history message', () => {
			const result = parseCommandLine(
				JSON.stringify({
					cmd: 'start_session',
					id: 'cmd-history-extra-field',
					sessionId: 's',
					workstreamId: 'w',
					conversationHistory: [
						{ role: 'assistant', content: 'answer', reasoningContent: 'not sent' },
					],
				}),
			);
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.code).toBe('INVALID_PAYLOAD');
				expect(result.message).toContain('may only contain role and content');
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
