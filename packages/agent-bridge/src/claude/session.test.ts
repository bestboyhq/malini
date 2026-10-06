import type { SDKMessage, SDKResultSuccess } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import type { AgentRunProfile } from '../agent-profile.js';
import type { ProviderContext } from '../providers/types.js';
import type { AgentEvent } from '../types.js';
import { fakeClaude, recordedScript, type ScriptStep } from './fixtures/fake-claude.js';
import { ClaudeSession } from './session.js';

const READ_AND_BASH_SESSION = 'c0a96268-cd2e-40f9-88f1-f8c53c9cbbc7';
const READ_AND_BASH_CURSOR = '14372fe3-16a6-4ab1-8c70-ee97865c9a65';

const CONTEXT: ProviderContext = {
	sessionId: 'session-1',
	workstreamId: 'workstream-1',
	cwd: '/work/repo',
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
	} = {},
) {
	const claude = fakeClaude(scripts);
	const events: AgentEvent[] = [];
	const session: ClaudeSession = new ClaudeSession({
		context: { ...CONTEXT, ...options.context },
		emit: (event) => {
			events.push(event);
			options.onEvent?.(event, session);
		},
		executable: options.executable === undefined ? '/opt/claude/bin/claude' : options.executable,
		query: claude.query,
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
		expect(claude.runs[0]?.closed).toBe(true);

		await session.sendPrompt('And again', 'run-2', profile(), READ_AND_BASH_CURSOR);

		expect(claude.runs[1]?.options).toMatchObject({
			resume: READ_AND_BASH_SESSION,
			resumeSessionAt: READ_AND_BASH_CURSOR,
		});
		expect(events.at(-1)).toMatchObject({ type: 'run.completed', runId: 'run-2' });
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
			{ behavior: 'deny', message: expect.stringContaining('malini now shows this plan') },
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
