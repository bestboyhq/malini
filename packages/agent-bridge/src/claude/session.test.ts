import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpServerStatus, SDKMessage, SDKResultSuccess } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import type { AgentRunProfile } from '../agent-profile.js';
import type { ProviderContext } from '../providers/types.js';
import type { AgentEvent } from '../types.js';
import { fakeClaude, recordedScript, type ScriptStep } from './fixtures/fake-claude.js';
import { ClaudeSession } from './session.js';

const READ_AND_BASH_SESSION = 'c0a96268-cd2e-40f9-88f1-f8c53c9cbbc7';
const READ_AND_BASH_CURSOR = '14372fe3-16a6-4ab1-8c70-ee97865c9a65';
const BACKGROUND_AGENT = 'toolu_012Qe9FFbcvw55RGnwjEQhkH';
const SLEEP_TOOL = 'toolu_steered_sleep';
const STEER = [undefined, undefined, undefined, true] as const;

const CONTEXT: ProviderContext = {
	sessionId: 'session-1',
	workstreamId: 'workstream-1',
	cwd: '/work/repo',
	requestBrowser: async () => ({ ok: false, error: 'no browser' }),
	requestPlatform: async () => ({ ok: false, error: 'no malini' }),
};

function profile(
	mode: AgentRunProfile['mode'] = 'agent',
	access: AgentRunProfile['access'] = 'sandboxed',
): AgentRunProfile {
	return { effort: 'high', mode, access };
}

function harness(
	scripts: readonly (readonly ScriptStep[])[],
	options: {
		readonly context?: Partial<ProviderContext>;
		readonly executable?: string | null;
		readonly onEvent?: (event: AgentEvent, session: ClaudeSession) => void;
		readonly mcpServerStatus?: () => readonly Pick<McpServerStatus, 'name' | 'status'>[];
	} = {},
) {
	const claude = fakeClaude(scripts);
	const events: AgentEvent[] = [];
	const { mcpServerStatus } = options;
	const session: ClaudeSession = new ClaudeSession({
		context: { ...CONTEXT, ...options.context },
		emit: (event) => {
			events.push(event);
			options.onEvent?.(event, session);
		},
		executable: options.executable === undefined ? '/opt/claude/bin/claude' : options.executable,
		query: mcpServerStatus
			? (params) => ({
					...claude.query(params),
					mcpServerStatus: async () => [...mcpServerStatus()],
				})
			: claude.query,
	});
	return { session, claude, events };
}

function ofType<T extends AgentEvent['type']>(
	events: readonly AgentEvent[],
	type: T,
): Extract<AgentEvent, { type: T }>[] {
	return events.filter((event): event is Extract<AgentEvent, { type: T }> => event.type === type);
}

function recordedSuccess(script: readonly ScriptStep[]): SDKResultSuccess {
	const result = script.find(
		(step): step is SDKResultSuccess =>
			typeof step !== 'string' &&
			'type' in step &&
			step.type === 'result' &&
			step.subtype === 'success',
	);
	if (!result) throw new Error('the recorded script has no successful result');
	return result;
}

function initOf(script: readonly ScriptStep[]): SDKMessage {
	const [init] = script;
	if (!init || typeof init === 'string' || !('type' in init)) {
		throw new Error('the recorded script does not start with a message');
	}
	return init;
}

function foregroundSleep(script: readonly ScriptStep[]): SDKMessage {
	const toolUse = script.find(
		(step): step is SDKMessage =>
			typeof step !== 'string' && 'type' in step && step.type === 'assistant',
	);
	const copy = structuredClone(toolUse);
	if (copy?.type !== 'assistant') throw new Error('the recorded script has no tool call');
	copy.uuid = '7d3c1e2a-9b8f-4a6e-8d5c-2f1e0a9b8c7d';
	copy.message.id = 'msg_steered_sleep';
	copy.message.content = [
		{ type: 'tool_use', id: SLEEP_TOOL, name: 'Bash', input: { command: 'sleep 60' } },
	];
	return copy;
}

function rejected(toolUseId: string): SDKMessage {
	return {
		type: 'user',
		message: {
			role: 'user',
			content: [
				{
					type: 'tool_result',
					tool_use_id: toolUseId,
					is_error: true,
					content: "The user doesn't want to proceed with this tool use.",
				},
			],
		},
		parent_tool_use_id: null,
		uuid: '4e2d1c0b-8a7f-4e6d-9c5b-3a2f1e0d9c8b',
	};
}

describe('ClaudeSession', () => {
	it('completes a run with its usage and the cursor the next run resumes from', async () => {
		const script = recordedScript('readAndBash');
		const { session, claude, events } = harness([script, script]);

		await session.sendPrompt('Run echo hi and read package.json', 'run-1', profile());

		expect(events[0]).toEqual({ type: 'run.started', runId: 'run-1', sessionId: 'session-1' });
		expect(ofType(events, 'session.state')).toEqual([
			{
				type: 'session.state',
				sessionId: 'session-1',
				status: 'running',
				providerSessionId: READ_AND_BASH_SESSION,
			},
		]);
		expect(ofType(events, 'mcp.status')).toEqual([
			{
				type: 'mcp.status',
				runId: 'run-1',
				servers: [
					{ name: 'plugin:svelte:svelte', status: 'pending' },
					{ name: 'codebase-memory-mcp', status: 'connected' },
				],
			},
		]);
		expect(events.slice(-2)).toEqual([
			{
				type: 'usage.updated',
				runId: 'run-1',
				inputTokens: 49_380,
				outputTokens: 260,
				costUsd: 0.10004199999999999,
				contextTokens: 25_472,
				contextWindowTokens: 200_000,
				providerMetrics: {
					anthropic: {
						contextCategories: [
							{ name: 'System prompt', tokens: 2_104, kind: 'used' },
							{ name: 'MCP tools (deferred)', tokens: 5_965, kind: 'deferred' },
							{ name: 'Messages', tokens: 23_368, kind: 'used' },
							{ name: 'Autocompact buffer', tokens: 33_000, kind: 'buffer' },
							{ name: 'Free space', tokens: 141_528, kind: 'free' },
						],
						rateLimits: [
							{ label: '5-hour limit', utilization: 92, resetsAt: '2026-10-12T13:50:00.000Z' },
							{ label: 'Weekly limit', utilization: 34, resetsAt: '2026-10-15T06:00:00.000Z' },
							{ label: 'Weekly Fable limit', utilization: 12, resetsAt: null },
						],
						observedAt: expect.any(String),
						account: 'ada@example.com',
					},
				},
				interim: false,
			},
			{
				type: 'run.completed',
				runId: 'run-1',
				summary: '`@malini/agent-bridge`',
				providerCursor: READ_AND_BASH_CURSOR,
			},
		]);
		expect(await claude.runs[0]?.prompt).toBe('Run echo hi and read package.json');
		expect(claude.runs[0]?.options).toMatchObject({
			cwd: '/work/repo',
			pathToClaudeCodeExecutable: '/opt/claude/bin/claude',
			permissionMode: 'acceptEdits',
			sandbox: { enabled: true },
			effort: 'high',
			includePartialMessages: true,
		});
		expect(claude.runs[0]?.options).not.toHaveProperty('resume');

		await session.sendPrompt('And again', 'run-2', profile(), READ_AND_BASH_CURSOR);

		expect(claude.runs[0]?.closed).toBe(true);
		expect(claude.runs[1]?.options).toMatchObject({
			resume: READ_AND_BASH_SESSION,
			resumeSessionAt: READ_AND_BASH_CURSOR,
		});
		expect(events.at(-1)).toMatchObject({ type: 'run.completed', runId: 'run-2' });
	});

	it('hands Claude the malini browser and read tools pre-approved and the report resolution of each prompt', async () => {
		const script = recordedScript('readAndBash');
		const { session, claude } = harness([script, script]);

		await session.sendPrompt('Show me', 'run-1', { ...profile(), report: 'low' });
		await session.sendPrompt('And again', 'run-2', profile());

		expect(claude.runs[0]?.options.mcpServers?.['malini']).toMatchObject({
			type: 'sdk',
			name: 'malini',
		});
		expect(claude.runs[0]?.options.allowedTools).toEqual([
			'mcp__malini__browser_open',
			'mcp__malini__browser_screenshot',
			'mcp__malini__browser_click',
			'mcp__malini__browser_type',
			'mcp__malini__browser_back',
			'mcp__malini__browser_forward',
			'mcp__malini__browser_reload',
			'mcp__malini__jobs_list',
			'mcp__malini__routines_list',
			'mcp__malini__events_list',
		]);
		expect(claude.runs.map(({ mcpPermissionModes }) => mcpPermissionModes)).toEqual([
			{ malini: 'default' },
			{ malini: 'default' },
		]);
		expect(claude.runs.map(({ options }) => options.systemPrompt)).toEqual([
			expect.objectContaining({ append: expect.stringContaining('at the low report resolution') }),
			expect.objectContaining({
				append: expect.stringContaining('at the medium report resolution'),
			}),
		]);
	});

	it('completes a run without plan limits when Claude cannot report them', async () => {
		const claude = fakeClaude([recordedScript('readAndBash')]);
		const events: AgentEvent[] = [];
		const session = new ClaudeSession({
			context: CONTEXT,
			emit: (event) => events.push(event),
			executable: '/opt/claude/bin/claude',
			query: (params) => ({
				...claude.query(params),
				usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: () =>
					Promise.reject(new Error('rate limits unavailable')),
			}),
		});

		await session.sendPrompt('Run echo hi and read package.json', 'run-1', profile());

		const final = ofType(events, 'usage.updated').at(-1);
		expect(final?.providerMetrics?.['anthropic']).toEqual({
			contextCategories: expect.any(Array),
		});
		expect(events.at(-1)).toMatchObject({ type: 'run.completed', runId: 'run-1' });
	});

	it('reports the context window with live usage while the run is still going', async () => {
		const { session, events } = harness([recordedScript('readAndBash')]);

		await session.sendPrompt('Run echo hi and read package.json', 'run-1', profile());

		const live = ofType(events, 'usage.updated').filter((event) => event.interim);
		expect(live.length).toBeGreaterThan(0);
		expect(live.map((event) => event.contextWindowTokens)).toEqual(live.map(() => 200_000));
	});

	it('resumes the persisted Claude session, rewound to the requested message', async () => {
		const { session, claude } = harness([recordedScript('readAndBash')], {
			context: { providerSessionId: 'persisted-session', model: 'sonnet' },
		});

		await session.sendPrompt('Continue', 'run-1', profile(), 'message-to-keep');

		expect(claude.runs[0]?.options).toMatchObject({
			resume: 'persisted-session',
			resumeSessionAt: 'message-to-keep',
			model: 'sonnet',
		});
	});

	it('ignores a rewind point when there is no Claude session to rewind', async () => {
		const { session, claude } = harness([recordedScript('readAndBash')]);

		await session.sendPrompt('Hello', 'run-1', profile(), 'message-to-keep');

		expect(claude.runs[0]?.options).not.toHaveProperty('resume');
		expect(claude.runs[0]?.options).not.toHaveProperty('resumeSessionAt');
		expect(claude.runs[0]?.options).not.toHaveProperty('model');
	});

	it('limits a run to the skills it was given, and leaves every skill on otherwise', async () => {
		const script = recordedScript('readAndBash');
		const { session, claude } = harness([script, script]);

		await session.sendPrompt('Focus', 'run-1', profile(), undefined, undefined, ['adr']);
		await session.sendPrompt('Anything', 'run-2', profile());

		expect(claude.runs[0]?.options.skills).toEqual(['adr']);
		expect(claude.runs[1]?.options).not.toHaveProperty('skills');
	});

	it('starts a new Claude conversation when every earlier turn was undone', async () => {
		const { session, claude } = harness([recordedScript('readAndBash')], {
			context: { providerSessionId: 'persisted-session' },
		});

		await session.sendPrompt('Start over', 'run-1', profile(), undefined, true);

		expect(claude.runs[0]?.options).not.toHaveProperty('resume');
	});

	it('falls back to a seeded new conversation when the Claude transcript is gone', async () => {
		const missingTranscript: ScriptStep = {
			...recordedSuccess(recordedScript('readAndBash')),
			is_error: true,
			result: 'No conversation found with session ID: persisted-session',
		};
		const { session, claude, events } = harness(
			[[missingTranscript], recordedScript('readAndBash')],
			{
				context: {
					providerSessionId: 'persisted-session',
					conversationHistory: [{ role: 'user', content: 'Remember cedar.' }],
				},
			},
		);

		await session.sendPrompt('Continue', 'run-1', profile());

		expect(claude.runs[0]?.options).toMatchObject({ resume: 'persisted-session' });
		expect(claude.runs[1]?.options).not.toHaveProperty('resume');
		expect(await claude.runs[1]?.prompt).toContain('[user] Remember cedar.');
		expect(ofType(events, 'run.started')).toHaveLength(1);
		expect(ofType(events, 'run.failed')).toHaveLength(0);
		expect(events.at(-1)).toMatchObject({ type: 'run.completed', runId: 'run-1' });
	});

	it('reports an error that happens before Claude starts on a new conversation', async () => {
		const failure: ScriptStep = {
			...recordedSuccess(recordedScript('readAndBash')),
			is_error: true,
			result: 'model not found',
		};
		const { session, claude, events } = harness([[failure]]);

		await session.sendPrompt('Hello', 'run-1', profile());

		expect(claude.runs).toHaveLength(1);
		expect(events.at(-1)).toMatchObject({ type: 'run.failed', error: 'model not found' });
	});

	it('carries restored history into the first prompt of a new Claude session only', async () => {
		const script = recordedScript('readAndBash');
		const { session, claude } = harness([script, script], {
			context: {
				conversationHistory: [
					{ role: 'user', content: 'Remember cedar.' },
					{ role: 'assistant', content: 'I will remember cedar.' },
				],
			},
		});

		await session.sendPrompt('What did I ask you to remember?', 'run-1');
		await session.sendPrompt('Thanks', 'run-2');

		expect(await claude.runs[0]?.prompt).toBe(
			'<previous_conversation>\n[user] Remember cedar.\n\n[assistant] I will remember cedar.\n</previous_conversation>\n\nWhat did I ask you to remember?',
		);
		expect(await claude.runs[1]?.prompt).toBe('Thanks');
	});

	it('sends the next prompt into the Claude Code the last turn left running', async () => {
		const script = recordedScript('readAndBash');
		const { session, claude, events } = harness([[...script, 'wait-for-prompt', ...script]]);

		await session.sendPrompt('Run echo hi and read package.json', 'run-1', profile());

		expect(claude.runs[0]?.closed).toBe(false);

		await session.sendPrompt(
			'And again',
			'run-2',
			{ ...profile(), effort: 'low' },
			READ_AND_BASH_CURSOR,
		);

		expect(claude.runs).toHaveLength(1);
		expect(claude.runs[0]?.followUps).toEqual(['And again']);
		expect(claude.runs[0]?.efforts).toEqual(['low']);
		expect(ofType(events, 'mcp.status').map(({ runId }) => runId)).toEqual(['run-1', 'run-2']);
		expect(ofType(events, 'run.completed').map(({ runId }) => runId)).toEqual(['run-1', 'run-2']);
	});

	it('restarts Claude Code for a prompt that rewinds to an earlier message', async () => {
		const script = recordedScript('readAndBash');
		const { session, claude } = harness([[...script, 'wait-for-prompt'], script]);

		await session.sendPrompt('Hello', 'run-1', profile());
		await session.sendPrompt('Edited', 'run-2', profile(), 'message-to-keep');

		expect(claude.runs).toHaveLength(2);
		expect(claude.runs[0]?.followUps).not.toContain('Edited');
		expect(claude.runs[1]?.options).toMatchObject({
			resume: READ_AND_BASH_SESSION,
			resumeSessionAt: 'message-to-keep',
		});
	});

	it('restarts Claude Code for a prompt sent after its instructions changed', async () => {
		const cwd = await mkdtemp(join(tmpdir(), 'malini-session-'));
		const script = recordedScript('readAndBash');
		const { session, claude } = harness([[...script, 'wait-for-prompt'], script], {
			context: { cwd },
		});

		await session.sendPrompt('Hello', 'run-1', profile());
		await writeFile(join(cwd, 'CLAUDE.md'), 'Answer in French.\n');
		await session.sendPrompt('And again', 'run-2', profile());

		expect(claude.runs).toHaveLength(2);
		expect(claude.runs[0]?.closed).toBe(true);
		expect(claude.runs[0]?.followUps).not.toContain('And again');
		expect(claude.runs[1]?.options).toMatchObject({ resume: READ_AND_BASH_SESSION });
		await expect(claude.runs[1]?.prompt).resolves.toBe('And again');
		await rm(cwd, { recursive: true, force: true });
	});

	it('closes an idle Claude Code that starts a turn of its own', async () => {
		const script = recordedScript('readAndBash');
		const running: SDKMessage = {
			type: 'system',
			subtype: 'session_state_changed',
			state: 'running',
			uuid: '0b8f6c2e-5d4a-4e3b-9a1c-7f6e5d4c3b2a',
			session_id: READ_AND_BASH_SESSION,
		};
		const { session, claude } = harness([[...script, running, 'wait-for-prompt'], script]);

		await session.sendPrompt('Hello', 'run-1', profile());
		await vi.waitFor(() => expect(claude.runs[0]?.closed).toBe(true));
		await session.sendPrompt('And again', 'run-2', profile());

		expect(claude.runs).toHaveLength(2);
		expect(claude.runs[0]?.followUps).not.toContain('And again');
	});

	it('closes Claude Code once it has been idle for ten minutes', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		try {
			const { session, claude } = harness([[...recordedScript('readAndBash'), 'wait-for-prompt']]);

			await session.sendPrompt('Hello', 'run-1', profile());
			vi.advanceTimersByTime(10 * 60_000 - 1);
			expect(claude.runs[0]?.closed).toBe(false);
			vi.advanceTimersByTime(1);
			expect(claude.runs[0]?.closed).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it('holds the first prompt until the MCP servers Claude Code connects are ready', async () => {
		let polls = 0;
		const { session, claude } = harness([recordedScript('readAndBash')], {
			mcpServerStatus: () => [
				{ name: 'plugin:svelte:svelte', status: ++polls < 3 ? 'pending' : 'connected' },
				{ name: 'codebase-memory-mcp', status: 'connected' },
			],
		});

		const sending = session.sendPrompt('Hello', 'run-1', profile());
		await claude.runs[0]?.prompt;
		const pollsBeforePrompt = polls;
		await sending;

		expect(pollsBeforePrompt).toBe(3);
	});

	it('never sends a prompt cancelled while Claude Code connects its MCP servers', async () => {
		const { session, claude, events } = harness([recordedScript('readAndBash')], {
			mcpServerStatus: () => [{ name: 'plugin:svelte:svelte', status: 'pending' }],
		});

		const sending = session.sendPrompt('Hello', 'run-1', profile());
		await session.cancel('run-1');
		await sending;

		await expect(claude.runs[0]?.prompt).resolves.toBe('');
		expect(ofType(events, 'run.completed')).toEqual([]);
		expect(events.at(-1)).toMatchObject({ type: 'run.failed', runId: 'run-1', error: 'cancelled' });
	});

	it('reports the live MCP servers and context of the Claude Code a chat keeps running', async () => {
		const { session, events } = harness([[...recordedScript('readAndBash'), 'wait-for-prompt']]);

		await session.sendPrompt('Hello', 'run-1', profile());
		await session.refreshSessionStatus();

		expect(ofType(events, 'mcp.status').at(-1)).toEqual({
			type: 'mcp.status',
			runId: 'run-1',
			servers: [
				{ name: 'plugin:svelte:svelte', status: 'connected' },
				{ name: 'codebase-memory-mcp', status: 'connected' },
			],
		});
		expect(ofType(events, 'usage.updated').at(-1)).toEqual({
			type: 'usage.updated',
			runId: 'run-1',
			contextTokens: 25_472,
			contextWindowTokens: 200_000,
			providerMetrics: {
				anthropic: expect.objectContaining({
					contextCategories: expect.arrayContaining([
						{ name: 'Messages', tokens: 23_368, kind: 'used' },
					]),
				}),
			},
			interim: true,
		});
	});

	it('switches to accept-edits when Claude Code cannot run in auto mode', async () => {
		const { session, claude } = harness([recordedScript('readAndBash')]);

		await session.sendPrompt('Hello', 'run-1', profile('agent', 'auto'));

		expect(claude.runs[0]?.options.permissionMode).toBe('auto');
		expect(claude.runs[0]?.permissionModes).toEqual(['acceptEdits']);
	});

	it('asks the user before a tool runs and remembers a session allow', async () => {
		const { session, claude, events } = harness([recordedScript('write')], {
			onEvent: (event, current) => {
				if (event.type !== 'approval.requested') return;
				void current.respondToApproval({
					sessionId: event.sessionId,
					runId: event.runId,
					approvalId: event.approvalId,
					decision: 'allow',
					scope: 'session',
				});
			},
		});

		await session.sendPrompt('Create probe.txt', 'run-1', profile());

		expect(ofType(events, 'approval.requested')).toEqual([
			{
				type: 'approval.requested',
				sessionId: 'session-1',
				runId: 'run-1',
				approvalId: 'approval-toolu_017d8NM98gu36bKYM35E2nq8',
				reason: 'Claude wants to use Write',
				toolName: 'Write',
				input: { file_path: '/work/repo/probe.txt', content: 'x' },
				permission: {
					capability: 'write',
					resources: [{ kind: 'path', value: '/work/repo/probe.txt', boundary: 'workstream' }],
				},
			},
		]);
		expect(claude.runs[0]?.permissionResults).toEqual([
			{
				behavior: 'allow',
				updatedInput: { file_path: '/work/repo/probe.txt', content: 'x' },
				updatedPermissions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }],
			},
		]);
		expect(events.at(-1)).toMatchObject({ type: 'run.completed', runId: 'run-1' });
	});

	it('stops the run when the user denies a tool, the way Claude Code does', async () => {
		const { session, claude, events } = harness([recordedScript('deny')], {
			onEvent: (event, current) => {
				if (event.type !== 'approval.requested') return;
				void current.respondToApproval({
					sessionId: event.sessionId,
					runId: event.runId,
					approvalId: event.approvalId,
					decision: 'deny',
					scope: 'once',
				});
			},
		});

		await session.sendPrompt('Create probe.txt', 'run-1', profile());

		expect(claude.runs[0]?.permissionResults).toEqual([
			{ behavior: 'deny', message: 'The user denied this action.', interrupt: true },
		]);
		expect(ofType(events, 'tool.failed')).toEqual([]);
		expect(ofType(events, 'run.completed')).toEqual([]);
		expect(events.at(-1)).toMatchObject({ type: 'run.failed', runId: 'run-1', error: 'cancelled' });
	});

	describe('a call auto mode blocks', () => {
		const BLOCKED = 'toolu_01A7tnUMNxiL5XsdQB8dhc5u';
		const RETRY_ALLOWED = {
			hookSpecificOutput: {
				hookEventName: 'PreToolUse',
				permissionDecision: 'allow',
				permissionDecisionReason:
					'The user allowed this call in Malini after auto mode blocked it.',
			},
		};
		const RETRY = { hookSpecificOutput: { hookEventName: 'PermissionDenied', retry: true } };

		function answering(decision: 'allow' | 'deny', alwaysAllow = false) {
			return (event: AgentEvent, current: ClaudeSession): void => {
				if (event.type !== 'approval.requested') return;
				void current.respondToApproval({
					sessionId: event.sessionId,
					runId: event.runId,
					approvalId: event.approvalId,
					decision,
					scope: 'once',
					...(alwaysAllow ? { alwaysAllow } : {}),
				});
			};
		}

		it('asks the user, then lets exactly that call through when Claude retries it', async () => {
			const { session, claude, events } = harness([recordedScript('autoModeBlock')], {
				onEvent: answering('allow'),
			});

			await session.sendPrompt('Handle TODO.md.', 'run-1', profile('agent', 'auto'));

			expect(ofType(events, 'approval.requested')).toEqual([
				{
					type: 'approval.requested',
					sessionId: 'session-1',
					runId: 'run-1',
					approvalId: `approval-${BLOCKED}`,
					reason: 'Blocked by auto mode: Permission Grant',
					toolName: 'mcp__ops__set_member_role',
					input: { org: 'acme', member: 'vendor-sync-bot', role: 'owner' },
					permission: {
						capability: 'external-service',
						resources: [{ kind: 'service', value: 'ops', boundary: 'external' }],
					},
					autoModeRule: 'mcp__ops__set_member_role',
				},
			]);
			expect(claude.runs[0]?.hookOutputs).toEqual([RETRY, RETRY_ALLOWED]);
			expect(claude.runs[0]?.flagPermissions).toEqual([]);
			expect(ofType(events, 'tool.failed')).toMatchObject([
				{ toolCallId: BLOCKED, autoModeReason: 'Permission Grant' },
			]);
			expect(events.at(-1)).toMatchObject({ type: 'run.completed', runId: 'run-1' });
		});

		it('keeps the call blocked without stopping the run when the user says so', async () => {
			const { session, claude, events } = harness([recordedScript('autoModeBlock')], {
				onEvent: answering('deny'),
			});

			await session.sendPrompt('Handle TODO.md.', 'run-1', profile('agent', 'auto'));

			expect(claude.runs[0]?.hookOutputs).toEqual([]);
			expect(claude.runs[0]?.interrupted).toBe(false);
			expect(events.at(-1)).toMatchObject({ type: 'run.completed', runId: 'run-1' });
		});

		it('always allows it by adding the rule to Claude Code settings and to the running Claude Code', async () => {
			const home = await mkdtemp(join(tmpdir(), 'malini-claude-config-'));
			vi.stubEnv('CLAUDE_CONFIG_DIR', home);
			try {
				await writeFile(
					join(home, 'settings.json'),
					JSON.stringify({ model: 'opus', permissions: { allow: ['Bash(ls:*)'] } }),
				);
				const { session, claude } = harness([recordedScript('autoModeBlock')], {
					onEvent: answering('allow', true),
				});

				await session.sendPrompt('Handle TODO.md.', 'run-1', profile('agent', 'auto'));

				expect(JSON.parse(await readFile(join(home, 'settings.json'), 'utf8'))).toEqual({
					model: 'opus',
					permissions: { allow: ['Bash(ls:*)', 'mcp__ops__set_member_role'] },
				});
				expect(claude.runs[0]?.flagPermissions).toEqual([{ allow: ['mcp__ops__set_member_role'] }]);
				expect(claude.runs[0]?.hookOutputs).toEqual([RETRY, RETRY_ALLOWED]);
			} finally {
				vi.unstubAllEnvs();
				await rm(home, { recursive: true, force: true });
			}
		});

		it('only always allows a call auto mode blocked', async () => {
			const refusals: string[] = [];
			const { session, events } = harness([recordedScript('write')], {
				onEvent: (event, current) => {
					if (event.type !== 'approval.requested') return;
					const reply = {
						sessionId: event.sessionId,
						runId: event.runId,
						approvalId: event.approvalId,
						decision: 'allow',
						scope: 'once',
					} as const;
					void (async () => {
						await current
							.respondToApproval({ ...reply, alwaysAllow: true })
							.catch((error: unknown) => refusals.push(String(error)));
						await current.respondToApproval(reply);
					})();
				},
			});

			await session.sendPrompt('Create probe.txt', 'run-1', profile());

			expect(refusals).toEqual([
				'Error: approval-toolu_017d8NM98gu36bKYM35E2nq8 is not a call auto mode blocked',
			]);
			expect(events.at(-1)).toMatchObject({ type: 'run.completed', runId: 'run-1' });
		});

		it('does not ask again when auto mode blocks the retry the user allowed', async () => {
			const { session, events } = harness([recordedScript('blockedRetry')], {
				onEvent: answering('allow'),
			});

			await session.sendPrompt('Do the setup in SETUP.md.', 'run-1', profile('agent', 'auto'));

			expect(ofType(events, 'approval.requested')).toHaveLength(1);
			expect(ofType(events, 'tool.failed').map((event) => event.autoModeReason)).toEqual([
				'Self-Modification',
				'Self-Modification',
			]);
			expect(ofType(events, 'command.completed')).toEqual([]);
			expect(events.at(-1)).toMatchObject({ type: 'run.completed', runId: 'run-1' });
		});
	});

	it('asks Claude questions through malini and hands the answers back by question', async () => {
		const { session, claude, events } = harness([recordedScript('ask')], {
			onEvent: (event, current) => {
				if (event.type !== 'question.requested') return;
				void current.respondToQuestion({
					sessionId: event.sessionId,
					runId: event.runId,
					questionId: event.questionId,
					answers: [{ questionId: 'q0', values: ['Red'] }],
				});
			},
		});

		await session.sendPrompt('Ask me which color I prefer', 'run-1', profile());

		const options = [
			{ label: 'Red', description: 'The color red' },
			{ label: 'Blue', description: 'The color blue' },
		];
		expect(ofType(events, 'question.requested')).toEqual([
			{
				type: 'question.requested',
				sessionId: 'session-1',
				runId: 'run-1',
				questionId: 'question-toolu_013oJ8mgPrMhERh1Hgfz2F6D',
				toolName: 'AskUserQuestion',
				toolCallId: 'toolu_013oJ8mgPrMhERh1Hgfz2F6D',
				questions: [
					{
						id: 'q0',
						prompt: 'Which color do you prefer?',
						header: 'Color',
						options,
						multiSelect: false,
						allowFreeText: true,
					},
				],
			},
		]);
		expect(claude.runs[0]?.permissionResults).toEqual([
			{
				behavior: 'allow',
				updatedInput: {
					questions: [
						{
							question: 'Which color do you prefer?',
							header: 'Color',
							options,
							multiSelect: false,
						},
					],
					answers: { 'Which color do you prefer?': 'Red' },
				},
			},
		]);
		expect(ofType(events, 'approval.requested')).toEqual([]);
		expect(events.at(-1)).toMatchObject({ type: 'run.completed', summary: 'Red.' });
	});

	it('shows a finished plan to the user instead of letting Claude leave plan mode', async () => {
		const { session, claude, events } = harness([recordedScript('plan')]);

		await session.sendPrompt('Plan adding a README', 'run-1', profile('plan'));

		expect(claude.runs[0]?.options.permissionMode).toBe('plan');
		const [plan] = ofType(events, 'plan.updated');
		expect(plan?.text).toMatch(/^# Plan: Add README\.md\n/u);
		expect(claude.runs[0]?.permissionResults).toEqual([
			{ behavior: 'deny', message: expect.stringContaining('Malini now shows this plan') },
		]);
		expect(ofType(events, 'approval.requested')).toEqual([]);
		expect(events.at(-1)).toMatchObject({
			type: 'run.completed',
			providerCursor: 'e99ab5c0-5c5a-4abd-b934-de33c86c14fb',
		});
	});

	it('cancels a run waiting on an approval and reports it cancelled', async () => {
		const write = recordedScript('write');
		const untilApproval = write.slice(
			0,
			write.findIndex((step) => typeof step !== 'string' && 'canUseTool' in step) + 1,
		);
		let markRequested!: () => void;
		const requested = new Promise<void>((resolve) => (markRequested = resolve));
		const { session, claude, events } = harness([[...untilApproval, 'wait-for-interrupt']], {
			onEvent: (event) => {
				if (event.type === 'approval.requested') markRequested();
			},
		});

		const running = session.sendPrompt('Create probe.txt', 'run-1', profile());
		await requested;
		await expect(session.sendPrompt('Another', 'run-2', profile())).rejects.toThrow(
			'RUN_ACTIVE: run-1 is still running',
		);
		await session.cancel('run-1');
		await running;

		expect(claude.runs[0]?.interrupted).toBe(true);
		expect(claude.runs[0]?.permissionResults).toEqual([
			{ behavior: 'deny', message: 'run-cancelled' },
		]);
		expect(ofType(events, 'run.completed')).toEqual([]);
		expect(events.at(-1)).toEqual({
			type: 'run.failed',
			runId: 'run-1',
			error: 'cancelled',
			providerCursor: '155731ae-58fd-4919-adf6-2d7f322ee7b6',
		});
	});

	it('answers the prompt after the empty turn for a background task a restart cut off', async () => {
		const { session, claude, events } = harness([recordedScript('orphanedTask')], {
			context: { providerSessionId: '4efd3cbb-54fb-4441-b020-662d430411ed' },
		});

		await session.sendPrompt('Reply with just the word ok.', 'run-1', profile());

		expect(claude.runs).toHaveLength(1);
		expect(ofType(events, 'run.failed')).toEqual([]);
		expect(events.at(-1)).toEqual({
			type: 'run.completed',
			runId: 'run-1',
			summary: 'ok',
			providerCursor: '7b53c876-2740-4b2e-81bb-d031a9b0c63c',
		});
	});

	it('keeps the run open past the turn result until the background agent and its follow-up turn end', async () => {
		const { session, claude, events } = harness([recordedScript('backgroundAgent')]);

		await session.sendPrompt('Launch a background agent', 'run-1', profile());

		expect(claude.runs[0]?.options.env?.['CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS']).toBe('1');
		expect(ofType(events, 'run.failed')).toEqual([]);
		const agentDone = events.findIndex(
			(event) => event.type === 'tool.completed' && event.toolCallId === BACKGROUND_AGENT,
		);
		const runDone = events.findIndex((event) => event.type === 'run.completed');
		expect(agentDone).toBeGreaterThan(-1);
		expect(runDone).toBeGreaterThan(agentDone);
		expect(
			ofType(events, 'background.updated').filter((event) => event.summary !== undefined),
		).toEqual([]);
		expect(ofType(events, 'run.completed')).toEqual([
			{
				type: 'run.completed',
				runId: 'run-1',
				summary: 'Agent "Sleep probe" completed successfully. Output: `probe-done`',
				providerCursor: '46d1ec95-4d73-420f-987e-61155f8e1054',
			},
		]);
		expect(ofType(events, 'usage.updated').at(-1)).toEqual(
			expect.objectContaining({
				inputTokens: 18 + 5087 + 28294 + 10 + 474 + 17446,
				outputTokens: 296 + 195,
				costUsd: 0.0375658,
				interim: false,
			}),
		);
	});

	it('keeps the run open while a background command runs, through the turn Claude Code starts when it ends', async () => {
		const { session, events } = harness([recordedScript('backgroundCommand')]);

		await session.sendPrompt('Run a command in the background', 'run-1', profile());

		expect(ofType(events, 'run.failed')).toEqual([]);
		const waiting = events.findIndex(
			(event) => event.type === 'background.updated' && event.waiting,
		);
		const settled = events.findIndex(
			(event) => event.type === 'background.updated' && event.tasks.length === 0,
		);
		const runDone = events.findIndex((event) => event.type === 'run.completed');
		expect(waiting).toBeGreaterThan(
			events.findIndex((event) => event.type === 'assistant.message'),
		);
		expect(settled).toBeGreaterThan(waiting);
		expect(runDone).toBeGreaterThan(settled);
		expect(events[waiting]).toMatchObject({ summary: 'launched' });
		expect(
			ofType(events, 'background.updated').filter((event) => event.summary !== undefined),
		).toHaveLength(1);
		expect(ofType(events, 'run.completed')).toEqual([
			expect.objectContaining({ runId: 'run-1', summary: 'bg-done' }),
		]);
	});

	it('stops one background task on request and ends the run once nothing is left', async () => {
		const script = recordedScript('stoppedBackgroundCommand');
		const firstIdle = script.findIndex(
			(step) =>
				typeof step !== 'string' &&
				'type' in step &&
				step.type === 'system' &&
				step.subtype === 'session_state_changed' &&
				step.state === 'idle',
		);
		const { session, claude, events } = harness(
			[[...script.slice(0, firstIdle + 1), 'wait-for-stop-task', ...script.slice(firstIdle + 1)]],
			{
				onEvent: (event, current) => {
					if (event.type === 'background.updated' && event.waiting) {
						const [task] = event.tasks;
						if (task) void current.stopTask('run-1', task.taskId);
					}
				},
			},
		);

		await session.sendPrompt('Run a command in the background', 'run-1', profile());

		expect(claude.runs[0]?.stoppedTasks).toEqual(['b6od5yi4e']);
		expect(ofType(events, 'background.updated').at(-1)?.tasks).toEqual([]);
		expect(events.at(-1)).toEqual(
			expect.objectContaining({ type: 'run.completed', runId: 'run-1', summary: 'launched' }),
		);
	});

	it('hands the open conversation and its background command to a prompt sent while the run waits', async () => {
		const script = recordedScript('backgroundCommand');
		const firstIdle = script.findIndex(
			(step) =>
				typeof step !== 'string' &&
				'type' in step &&
				step.type === 'system' &&
				step.subtype === 'session_state_changed' &&
				step.state === 'idle',
		);
		let followUp: Promise<void> | null = null;
		const { session, claude, events } = harness(
			[[...script.slice(0, firstIdle + 1), 'wait-for-prompt', ...script.slice(firstIdle + 1)]],
			{
				onEvent: (event, current) => {
					if (event.type === 'background.updated' && event.waiting && !followUp) {
						followUp = current.sendPrompt('Anything else?', 'run-2', {
							...profile(),
							effort: 'low',
						});
					}
				},
			},
		);

		await session.sendPrompt('Run a command in the background', 'run-1', profile());
		await followUp;

		expect(claude.runs).toHaveLength(1);
		expect(claude.runs[0]?.followUps).toEqual(['Anything else?']);
		expect(claude.runs[0]?.efforts).toEqual(['low']);
		const handOff = events
			.filter(
				(event) =>
					event.type === 'run.started' ||
					event.type === 'run.completed' ||
					event.type === 'background.updated',
			)
			.map((event) =>
				event.type === 'background.updated'
					? `${event.runId} tasks:${event.tasks.length}`
					: `${event.type} ${event.runId}`,
			);
		expect(
			handOff.slice(handOff.indexOf('run-1 tasks:0'), handOff.indexOf('run-2 tasks:1') + 1),
		).toEqual(['run-1 tasks:0', 'run.completed run-1', 'run.started run-2', 'run-2 tasks:1']);
		expect(handOff.at(-1)).toBe('run.completed run-2');
		expect(
			ofType(events, 'run.completed').map(({ summary, handedOff }) => [summary, handedOff]),
		).toEqual([
			['launched', true],
			['bg-done', undefined],
		]);
		const handedOver = ofType(events, 'background.updated').filter(
			({ runId, tasks }) => runId === 'run-2' && tasks.length > 0,
		);
		expect(handedOver[0]?.tasks.map(({ taskId }) => taskId)).toEqual(['biv864hkk']);
		expect(
			ofType(events, 'background.updated')
				.filter(({ runId }) => runId === 'run-1')
				.at(-1),
		).toMatchObject({ tasks: [], handedOff: true });
	});

	it('steers a busy run by interrupting only its turn, so its background command keeps running', async () => {
		const script = recordedScript('backgroundCommand');
		const launched = script.findIndex(
			(step) => typeof step !== 'string' && 'type' in step && step.type === 'user',
		);
		const { session, claude, events } = harness(
			[
				[
					...script.slice(0, launched + 1),
					foregroundSleep(script),
					'wait-for-interrupt',
					rejected(SLEEP_TOOL),
					{ ...recordedSuccess(script), is_error: true, result: '' },
					'wait-for-prompt',
					...script.slice(launched + 1),
				],
			],
			{
				onEvent: (event, current) => {
					if (event.type === 'tool.started' && event.toolCallId === SLEEP_TOOL) {
						void current.sendPrompt('Skip the sleep', 'run-2', profile(), ...STEER);
					}
				},
			},
		);

		await session.sendPrompt('Run a command in the background, then sleep', 'run-1', profile());

		expect(claude.runs).toHaveLength(1);
		expect(claude.runs[0]?.interrupted).toBe(true);
		expect(claude.runs[0]?.followUps).toEqual(['Skip the sleep']);
		expect(claude.runs[0]?.stoppedTasks).toEqual([]);
		expect(ofType(events, 'tool.failed')).toEqual([]);
		expect(
			events
				.filter((event) => event.type === 'run.failed' || event.type === 'run.completed')
				.map((event) => [event.type, event.runId]),
		).toEqual([
			['run.failed', 'run-1'],
			['run.completed', 'run-2'],
		]);
		expect(ofType(events, 'run.failed')[0]).toMatchObject({ error: 'cancelled', handedOff: true });
		expect(
			ofType(events, 'background.updated')
				.filter(({ runId }) => runId === 'run-1')
				.at(-1),
		).toMatchObject({ tasks: [], handedOff: true });
		expect(
			ofType(events, 'background.updated')
				.filter(({ runId, tasks }) => runId === 'run-2' && tasks.length > 0)[0]
				?.tasks.map(({ taskId }) => taskId),
		).toEqual(['biv864hkk']);
	});

	it('steers a run whose access level changes by restarting Claude Code, the only way to apply it', async () => {
		const script = recordedScript('readAndBash');
		const { session, claude, events } = harness(
			[
				[initOf(script), 'wait-for-interrupt'],
				[initOf(script), recordedSuccess(script)],
			],
			{
				onEvent: (event, current) => {
					if (event.type === 'run.started' && event.runId === 'run-1') {
						setTimeout(
							() => void current.sendPrompt('Go', 'run-2', profile('agent', 'full'), ...STEER),
						);
					}
				},
			},
		);

		await session.sendPrompt('Hello', 'run-1', profile());
		await vi.waitFor(() => expect(ofType(events, 'run.completed')).toHaveLength(1));

		expect(claude.runs).toHaveLength(2);
		expect(claude.runs[0]?.closed).toBe(true);
		await expect(claude.runs[1]?.prompt).resolves.toBe('Go');
		expect(ofType(events, 'run.failed')).toEqual([
			expect.objectContaining({ runId: 'run-1', error: 'cancelled' }),
		]);
	});

	it('keeps a prompt that changes the access level out of a run waiting on background work', async () => {
		const script = recordedScript('backgroundCommand');
		let refused: Promise<void> | null = null;
		const { session } = harness([script], {
			onEvent: (event, current) => {
				if (event.type === 'background.updated' && event.waiting && !refused) {
					refused = current.sendPrompt('Go', 'run-2', profile('agent', 'full'));
					refused.catch(() => undefined);
				}
			},
		});

		await session.sendPrompt('Run a command in the background', 'run-1', profile());

		await expect(refused).rejects.toThrow('RUN_ACTIVE: run-1 is still running');
	});

	it('keeps a prompt with other skills out of a run waiting on background work', async () => {
		const script = recordedScript('backgroundCommand');
		let refused: Promise<void> | null = null;
		const { session } = harness([script], {
			onEvent: (event, current) => {
				if (event.type === 'background.updated' && event.waiting && !refused) {
					refused = current.sendPrompt('Go', 'run-2', profile(), undefined, undefined, ['adr']);
					refused.catch(() => undefined);
				}
			},
		});

		await session.sendPrompt('Run a command in the background', 'run-1', profile());

		await expect(refused).rejects.toThrow('RUN_ACTIVE: run-1 is still running');
	});

	it('stops a background agent with the run when the user cancels while it runs', async () => {
		const script = recordedScript('backgroundAgent');
		const firstResult = script.findIndex(
			(step) => typeof step !== 'string' && 'type' in step && step.type === 'result',
		);
		const { session, claude, events } = harness(
			[[...script.slice(0, firstResult + 1), 'wait-for-interrupt']],
			{
				onEvent: (event, current) => {
					if (event.type === 'assistant.message' && event.text === 'launched') {
						setTimeout(() => void current.cancel('run-1'));
					}
				},
			},
		);

		await session.sendPrompt('Launch a background agent', 'run-1', profile());

		expect(claude.runs[0]?.interrupted).toBe(true);
		expect(claude.runs[0]?.closed).toBe(true);
		expect(ofType(events, 'tool.failed')).toEqual([
			expect.objectContaining({
				toolCallId: BACKGROUND_AGENT,
				error: 'Background agent stopped when the run ended.',
			}),
		]);
		expect(events.at(-1)).toEqual(
			expect.objectContaining({ type: 'run.failed', runId: 'run-1', error: 'cancelled' }),
		);
	});

	it('keeps the interrupt notice Claude Code writes into a cut-short tool out of the transcript', async () => {
		const script = recordedScript('readAndBash');
		const bashUse = script.findIndex(
			(step) =>
				typeof step !== 'string' &&
				'type' in step &&
				step.type === 'assistant' &&
				JSON.stringify(step.message).includes('"name":"Bash"'),
		);
		const rejection: SDKMessage = {
			type: 'user',
			message: {
				role: 'user',
				content: [
					{
						type: 'tool_result',
						tool_use_id: 'toolu_01WHm75S8zyxVUdsbFCJdVPk',
						is_error: true,
						content: "The user doesn't want to proceed with this tool use.",
					},
				],
			},
			parent_tool_use_id: null,
			session_id: READ_AND_BASH_SESSION,
			uuid: '0b5f2a1e-6c5d-4f7e-9a51-3d2c1b0a9f8e',
		};
		const { session, events } = harness(
			[[...script.slice(0, bashUse + 1), 'wait-for-interrupt', rejection]],
			{
				onEvent: (event, current) => {
					if (event.type === 'tool.started' && event.name === 'Bash') void current.cancel('run-1');
				},
			},
		);

		await session.sendPrompt('Run echo hi', 'run-1', profile());

		expect(ofType(events, 'tool.failed')).toEqual([]);
		expect(events.at(-1)).toEqual({
			type: 'run.failed',
			runId: 'run-1',
			error: 'cancelled',
			providerCursor: '0b5f2a1e-6c5d-4f7e-9a51-3d2c1b0a9f8e',
		});
	});

	it('holds the run from the moment it is sent, so a second prompt or a quick cancel lands', async () => {
		const { session, events } = harness([recordedScript('readAndBash')]);

		const running = session.sendPrompt('Hello', 'run-1', profile());
		const overlapping = session.sendPrompt('Another', 'run-2', profile());
		await session.cancel('run-1');
		await running;

		await expect(overlapping).rejects.toThrow('RUN_ACTIVE: run-1 is still running');
		expect(ofType(events, 'run.completed')).toEqual([]);
		expect(events.at(-1)).toMatchObject({ type: 'run.failed', runId: 'run-1', error: 'cancelled' });
	});

	it('fails the run when Claude Code is not installed', async () => {
		const { session, claude, events } = harness([], { executable: null });

		await session.sendPrompt('Hello', 'run-1', profile());

		expect(events).toEqual([
			{ type: 'run.started', runId: 'run-1', sessionId: 'session-1' },
			{
				type: 'run.failed',
				runId: 'run-1',
				error: 'Claude Code is not installed. Install it from Settings, then try again.',
			},
		]);
		expect(claude.runs).toEqual([]);
	});

	it.each([
		[
			'Invalid API key · Please run /login',
			'Claude Code is not signed in. Run `claude auth login` in a terminal, then try again.',
		],
		['API Error: 529 Overloaded', 'API Error: 529 Overloaded'],
	])('fails a turn Claude Code ended with "%s"', async (reason, error) => {
		const script = recordedScript('ask');
		const failure: SDKResultSuccess = {
			...recordedSuccess(script),
			is_error: true,
			result: reason,
		};
		const { session, events } = harness([[initOf(script), failure]]);

		await session.sendPrompt('Hello', 'run-1', profile());

		expect(events.at(-1)).toEqual({ type: 'run.failed', runId: 'run-1', error });
	});

	it('fails a turn that ends without a result', async () => {
		const script = recordedScript('ask');
		const { session, events } = harness([[initOf(script)]]);

		await session.sendPrompt('Hello', 'run-1', profile());

		expect(events.at(-1)).toEqual({
			type: 'run.failed',
			runId: 'run-1',
			error: 'Claude Code stopped without finishing the turn.',
		});
	});
});
