import { describe, expect, it } from 'vitest';
import type { LiveEventEnvelope, StagedAgentAttachment } from '$contract/agent';
import { CHAT_AGENT_EVENT_CHANNEL } from '$contract/events';
import { createFakePlatform, type FakePlatform } from './create-fake-platform';

const ATTACHMENT: StagedAgentAttachment = {
	id: 'att-00000000000000000000000000000001',
	displayName: 'brief.pdf',
	relativePath: '.malini/agent-attachments/att-00000000000000000000000000000001/brief.pdf',
	mediaType: 'application/pdf',
	size: 42,
	sha256: 'b'.repeat(64),
};

function recordAgentEvents(fake: FakePlatform): LiveEventEnvelope[] {
	const envelopes: LiveEventEnvelope[] = [];
	fake.on(CHAT_AGENT_EVENT_CHANNEL, (payload) => envelopes.push(payload));
	return envelopes;
}

function eventType(envelope: LiveEventEnvelope | undefined): unknown {
	return envelope?.event.type;
}

function commandsCalled(fake: FakePlatform): string[] {
	return fake.calls.map((call) => call.command);
}

async function flushMicrotasks(count: number): Promise<void> {
	for (let i = 0; i < count; i += 1) {
		await Promise.resolve();
	}
}

describe('the fake chat staged attachments', () => {
	it('exposes a deterministic cancelled attachment picker boundary', async () => {
		const fake = createFakePlatform({ projects: [], workstreams: [] });

		await expect(
			fake.invoke('chat.pick-and-stage-attachments', { workstreamId: 'ws-attachments' }),
		).resolves.toEqual([]);
		expect(fake.calls.at(-1)).toEqual({
			command: 'chat.pick-and-stage-attachments',
			args: { workstreamId: 'ws-attachments' },
		});
	});

	it('returns cloned staged attachment selections from the workstream seed', async () => {
		const fake = createFakePlatform({
			projects: [],
			workstreams: [],
			stagedAgentAttachments: { 'ws-attachments': [ATTACHMENT] },
		});

		const selected = await fake.invoke('chat.pick-and-stage-attachments', {
			workstreamId: 'ws-attachments',
		});
		expect(selected).toEqual([ATTACHMENT]);
		expect(selected[0]).not.toBe(ATTACHMENT);
		const again = await fake.invoke('chat.pick-and-stage-attachments', {
			workstreamId: 'ws-attachments',
		});
		expect(again[0]).not.toBe(selected[0]);
	});

	it('removes a staged attachment through the typed workstream boundary', async () => {
		const fake = createFakePlatform({
			projects: [],
			workstreams: [],
			stagedAgentAttachments: { 'ws-attachments': [ATTACHMENT] },
		});

		await expect(
			fake.invoke('chat.remove-staged-attachment', {
				workstreamId: 'ws-attachments',
				attachmentId: ATTACHMENT.id,
			}),
		).resolves.toBeUndefined();
		expect(fake.calls.at(-1)).toEqual({
			command: 'chat.remove-staged-attachment',
			args: { workstreamId: 'ws-attachments', attachmentId: ATTACHMENT.id },
		});
		await expect(
			fake.invoke('chat.pick-and-stage-attachments', { workstreamId: 'ws-attachments' }),
		).resolves.toEqual([]);
	});

	it('keeps staged attachment state intact when native removal fails', async () => {
		const fake = createFakePlatform({
			projects: [],
			workstreams: [],
			stagedAgentAttachments: { 'ws-attachments': [ATTACHMENT] },
			removeStagedAgentAttachmentErrors: { [ATTACHMENT.id]: 'attachment is already bound' },
		});

		await expect(
			fake.invoke('chat.remove-staged-attachment', {
				workstreamId: 'ws-attachments',
				attachmentId: ATTACHMENT.id,
			}),
		).rejects.toThrow('attachment is already bound');
		await expect(
			fake.invoke('chat.pick-and-stage-attachments', { workstreamId: 'ws-attachments' }),
		).resolves.toEqual([ATTACHMENT]);
	});
});

describe('the fake chat agent', () => {
	it('always reports a healthy agent process', async () => {
		const fake = createFakePlatform();

		await expect(fake.invoke('chat.agent-health', undefined)).resolves.toBe(true);
		expect(fake.calls.at(-1)).toEqual({ command: 'chat.agent-health', args: undefined });
	});

	it('emits a scripted event order deterministically across three runs', async () => {
		const fake = createFakePlatform();
		fake.script([
			({ sessionId, runId }) => ({ type: 'run.started', sessionId, runId }),
			({ runId }) => ({ type: 'tool.started', runId, name: 'Edit' }),
			({ runId }) => ({ type: 'tool.completed', runId, name: 'Edit' }),
			({ runId }) => ({ type: 'file.changed', runId, path: 'src/fake.ts' }),
			({ runId }) => ({ type: 'run.completed', runId, summary: 'done' }),
		]);
		const envelopes = recordAgentEvents(fake);

		const sessionId = await fake.invoke('chat.start-session', {
			workstreamId: 'ws-1',
			model: 'claude-haiku-4-5',
		});

		for (let i = 0; i < 3; i += 1) {
			await fake.invoke('chat.send-prompt', { sessionId, prompt: `prompt ${i + 1}` });
			await flushMicrotasks(8);
		}

		expect(envelopes.map(eventType)).toEqual([
			'run.started',
			'tool.started',
			'tool.completed',
			'file.changed',
			'run.completed',
			'run.started',
			'tool.started',
			'tool.completed',
			'file.changed',
			'run.completed',
			'run.started',
			'tool.started',
			'tool.completed',
			'file.changed',
			'run.completed',
		]);
		expect(envelopes.map((envelope) => envelope.seq)).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
		]);
		expect(new Set(envelopes.map((envelope) => envelope.runId))).toEqual(
			new Set(['fake-run-1', 'fake-run-2', 'fake-run-3']),
		);
		expect(
			await fake.invoke('repositories.workstream-change-totals', {
				workstreamId: 'ws-1',
				baseBranch: 'main',
			}),
		).toEqual({ additions: 2, deletions: 0, files: 1 });
	});

	it('cancels the active run and emits a terminal failure', async () => {
		const fake = createFakePlatform({
			agentScript: [({ sessionId, runId }) => ({ type: 'run.started', sessionId, runId })],
		});
		const envelopes = recordAgentEvents(fake);
		const sessionId = await fake.invoke('chat.start-session', { workstreamId: 'ws-1' });

		const sent = fake.invoke('chat.send-prompt', { sessionId, prompt: 'cancel me' });
		await fake.invoke('chat.cancel-run', { sessionId });
		await sent;
		await flushMicrotasks(3);

		expect(envelopes.map(eventType)).toEqual(['run.failed']);
		expect(envelopes[0]?.event.error).toBe('run cancelled');
	});

	it('pauses scripted runs for approval and structured answers and rejects replayed decisions', async () => {
		const fake = createFakePlatform();
		fake.script([
			({ sessionId, runId }) => ({ type: 'run.started', sessionId, runId }),
			({ sessionId, runId }) => ({
				type: 'approval.requested',
				sessionId,
				runId,
				approvalId: 'approval-1',
				reason: 'Read an external reference',
			}),
			({ sessionId, runId }) => ({
				type: 'question.requested',
				sessionId,
				runId,
				questionId: 'question-1',
				questions: [
					{
						id: 'question-1:0',
						prompt: 'Which runner?',
						options: [{ label: 'Vitest' }],
						multiSelect: false,
						allowFreeText: true,
					},
				],
			}),
			({ runId }) => ({ type: 'run.completed', runId, summary: 'done' }),
		]);
		const envelopes = recordAgentEvents(fake);
		const sessionId = await fake.invoke('chat.start-session', { workstreamId: 'ws-1' });
		const runId = await fake.invoke('chat.send-prompt', { sessionId, prompt: 'Ask me' });
		await flushMicrotasks(4);

		expect(envelopes.map(eventType)).toEqual(['run.started', 'approval.requested']);
		await fake.invoke('chat.decide-approval', {
			sessionId,
			runId,
			approvalId: 'approval-1',
			decision: 'allow',
			scope: 'once',
		});
		await flushMicrotasks(3);
		expect(eventType(envelopes.at(-1))).toBe('question.requested');
		await expect(
			fake.invoke('chat.decide-approval', {
				sessionId,
				runId,
				approvalId: 'approval-1',
				decision: 'allow',
				scope: 'once',
			}),
		).rejects.toThrow('Unknown or stale fake approval');
		await fake.invoke('chat.answer-question', {
			sessionId,
			runId,
			questionId: 'question-1',
			answers: [{ questionId: 'question-1:0', values: ['Vitest'] }],
		});
		await flushMicrotasks(3);
		expect(eventType(envelopes.at(-1))).toBe('run.completed');
	});

	it('returns seeded transcript events from chat.list-events', async () => {
		const fake = createFakePlatform({
			agentSessions: [
				{
					id: 'seeded-session-1',
					workstreamId: 'ws-1',
					model: 'claude-haiku-4-5',
				},
			],
			agentEvents: {
				'seeded-session-1': [
					{
						runId: 'seeded-run-1',
						event: { type: 'run.started', runId: 'seeded-run-1', sessionId: 'seeded-session-1' },
					},
					{
						runId: 'seeded-run-1',
						event: { type: 'assistant.message', runId: 'seeded-run-1', text: 'hello' },
					},
					{
						runId: 'seeded-run-1',
						event: { type: 'run.completed', runId: 'seeded-run-1', summary: 'done' },
						ephemeral: true,
					},
				],
			},
		});

		const all = await fake.invoke('chat.list-events', {
			sessionId: 'seeded-session-1',
			afterSeq: 0,
		});
		expect(all).toHaveLength(3);
		expect(all.map((envelope) => envelope.seq)).toEqual([1, 2, 3]);
		expect(all.map((envelope) => envelope.event.type)).toEqual([
			'run.started',
			'assistant.message',
			'run.completed',
		]);
		expect(Reflect.get(all[2] ?? {}, 'ephemeral')).toBe(true);
		expect(Reflect.get(all[0] ?? {}, 'ephemeral')).toBeUndefined();
	});

	it('projects a seeded latest terminal over a reusable idle session in chat.list-sessions', async () => {
		const fake = createFakePlatform({
			agentSessions: [
				{
					id: 'seeded-sidebar-failure',
					workstreamId: 'ws-sidebar',
					model: 'composer-2.5',
					status: 'idle',
				},
			],
			agentEvents: {
				'seeded-sidebar-failure': [
					{
						runId: 'run-sidebar-failure',
						event: {
							type: 'run.started',
							runId: 'run-sidebar-failure',
							sessionId: 'seeded-sidebar-failure',
						},
					},
					{
						runId: 'run-sidebar-failure',
						event: {
							type: 'run.failed',
							runId: 'run-sidebar-failure',
							error: 'Cannot use this model',
						},
					},
				],
			},
		});

		await expect(
			fake.invoke('chat.list-sessions', { workstreamId: 'ws-sidebar' }),
		).resolves.toMatchObject([{ id: 'seeded-sidebar-failure', status: 'failed' }]);
	});

	it('filters chat.list-events strictly by afterSeq', async () => {
		const fake = createFakePlatform({
			agentSessions: [{ id: 'seeded-session-2', workstreamId: 'ws-1' }],
			agentEvents: {
				'seeded-session-2': [
					{ runId: 'run-a', event: { type: 'run.started', runId: 'run-a' } },
					{ runId: 'run-a', event: { type: 'tool.started', runId: 'run-a', name: 'Edit' } },
					{ runId: 'run-a', event: { type: 'run.completed', runId: 'run-a', summary: 'done' } },
				],
			},
		});

		const afterFirst = await fake.invoke('chat.list-events', {
			sessionId: 'seeded-session-2',
			afterSeq: 1,
		});
		expect(afterFirst.map((envelope) => envelope.seq)).toEqual([2, 3]);

		const afterAll = await fake.invoke('chat.list-events', {
			sessionId: 'seeded-session-2',
			afterSeq: 3,
		});
		expect(afterAll).toEqual([]);

		const unknownSession = await fake.invoke('chat.list-events', {
			sessionId: 'no-such-session',
			afterSeq: 0,
		});
		expect(unknownSession).toEqual([]);
	});

	it('appends every emitted envelope to the per-session event log', async () => {
		const fake = createFakePlatform({
			agentScript: [
				({ sessionId, runId }) => ({ type: 'run.started', sessionId, runId }),
				({ runId }) => ({ type: 'run.completed', runId, summary: 'done' }),
			],
		});

		const sessionId = await fake.invoke('chat.start-session', { workstreamId: 'ws-1' });
		await fake.invoke('chat.send-prompt', { sessionId, prompt: 'log me' });
		await flushMicrotasks(4);

		const logged = await fake.invoke('chat.list-events', { sessionId, afterSeq: 0 });
		expect(logged.map((envelope) => envelope.event.type)).toEqual(['run.started', 'run.completed']);
		expect(logged.map((envelope) => envelope.seq)).toEqual([1, 2]);

		await fake.invoke('chat.cancel-run', { sessionId });
		await flushMicrotasks(2);

		const afterCancel = await fake.invoke('chat.list-events', { sessionId, afterSeq: 2 });
		expect(afterCancel).toEqual([]);
		const sessions = await fake.invoke('chat.list-sessions', { workstreamId: 'ws-1' });
		expect(sessions[0]?.status).toBe('completed');
	});

	it('resets stuck workstream runs and counts closed sessions', async () => {
		const fake = createFakePlatform({
			agentScript: [({ sessionId, runId }) => ({ type: 'run.started', sessionId, runId })],
		});
		const sessionA = await fake.invoke('chat.start-session', { workstreamId: 'ws-stuck' });
		const sessionB = await fake.invoke('chat.start-session', { workstreamId: 'ws-stuck' });
		const sessionOther = await fake.invoke('chat.start-session', { workstreamId: 'ws-other' });
		await fake.invoke('chat.send-prompt', { sessionId: sessionA, prompt: 'run a' });
		await fake.invoke('chat.send-prompt', { sessionId: sessionB, prompt: 'run b' });
		await fake.invoke('chat.send-prompt', { sessionId: sessionOther, prompt: 'run other' });
		await flushMicrotasks(4);

		const closed = await fake.invoke('chat.reset-workstream-runs', { workstreamId: 'ws-stuck' });
		expect(closed).toBe(2);

		const closedAgain = await fake.invoke('chat.reset-workstream-runs', {
			workstreamId: 'ws-stuck',
		});
		expect(closedAgain).toBe(0);
		expect(commandsCalled(fake)).toEqual(expect.arrayContaining(['chat.reset-workstream-runs']));
	});

	it('reuses the live session per workstream and records the call', async () => {
		const fake = createFakePlatform();

		const first = await fake.invoke('chat.get-or-create-session', {
			workstreamId: 'ws-reuse',
			model: 'claude-haiku-4-5',
		});
		const second = await fake.invoke('chat.get-or-create-session', { workstreamId: 'ws-reuse' });
		const elsewhere = await fake.invoke('chat.get-or-create-session', {
			workstreamId: 'ws-elsewhere',
		});

		expect(second).toBe(first);
		expect(elsewhere).not.toBe(first);
		expect(commandsCalled(fake)).toEqual(expect.arrayContaining(['chat.get-or-create-session']));
	});

	it('archives an idle session and excludes it from list and get-or-create reuse', async () => {
		const fake = createFakePlatform();
		const archived = await fake.invoke('chat.get-or-create-session', {
			workstreamId: 'ws-archive',
		});

		await fake.invoke('chat.archive-session', { sessionId: archived });
		await fake.invoke('chat.archive-session', { sessionId: archived });
		expect(await fake.invoke('chat.list-sessions', { workstreamId: 'ws-archive' })).toEqual([]);
		await expect(
			fake.invoke('chat.send-prompt', { sessionId: archived, prompt: 'do not revive this chat' }),
		).rejects.toThrow('archived fake session');

		const replacement = await fake.invoke('chat.get-or-create-session', {
			workstreamId: 'ws-archive',
		});
		expect(replacement).not.toBe(archived);
		expect(
			(await fake.invoke('chat.list-sessions', { workstreamId: 'ws-archive' })).map(
				(item) => item.id,
			),
		).toEqual([replacement]);
		expect(commandsCalled(fake)).toEqual(expect.arrayContaining(['chat.archive-session']));
	});

	it('refuses to archive a session while its run is active', async () => {
		const fake = createFakePlatform({
			agentScript: [({ sessionId, runId }) => ({ type: 'run.started', sessionId, runId })],
		});
		const sessionId = await fake.invoke('chat.start-session', {
			workstreamId: 'ws-archive-running',
		});
		await fake.invoke('chat.send-prompt', { sessionId, prompt: 'keep running' });

		await expect(fake.invoke('chat.archive-session', { sessionId })).rejects.toThrow(
			'while a run is active',
		);
		expect(
			await fake.invoke('chat.list-sessions', { workstreamId: 'ws-archive-running' }),
		).toHaveLength(1);
	});
});

describe('the fake chat changed files', () => {
	it('fails closed when changed-file reads cross a workstream boundary', async () => {
		const fake = createFakePlatform({
			projects: [
				{
					id: 'project-b',
					name: 'Project B',
					repoPath: '/tmp/project-b',
					defaultBranch: 'main',
				},
			],
			workstreams: [
				{
					id: 'workstream-a',
					projectId: 'project-b',
					name: 'Workstream A',
					path: '/tmp/project-b/a',
					branch: 'malini/a',
					baseBranch: 'main',
					status: 'active',
				},
				{
					id: 'workstream-b',
					projectId: 'project-b',
					name: 'Workstream B',
					path: '/tmp/project-b/b',
					branch: 'malini/b',
					baseBranch: 'main',
					status: 'active',
				},
			],
			agentSessions: [{ id: 'session-b', workstreamId: 'workstream-b' }],
			agentSessionChanges: {
				'session-b': {
					sessionId: 'session-b',
					runs: [],
					files: [],
					beforeCommit: null,
					afterCommit: null,
					capturedAt: null,
				},
			},
			agentRunChangePatches: {
				'session-b': {
					'run-b': {
						runId: 'run-b',
						beforeCommit: 'before-b',
						afterCommit: 'after-b',
						patch: 'private patch',
					},
				},
			},
		});

		await expect(
			fake.invoke('chat.session-changes', {
				workstreamId: 'workstream-b',
				sessionId: 'session-b',
			}),
		).resolves.toMatchObject({ sessionId: 'session-b' });
		await expect(
			fake.invoke('chat.session-changes', {
				workstreamId: 'workstream-a',
				sessionId: 'session-b',
			}),
		).rejects.toThrow('does not belong to the requested workstream');
		await expect(
			fake.invoke('chat.run-change-patch', {
				workstreamId: 'workstream-a',
				sessionId: 'session-b',
				runId: 'run-b',
			}),
		).rejects.toThrow('does not belong to the requested workstream');
	});
});
