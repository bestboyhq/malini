import { beforeEach, describe, expect, it } from 'vitest';
import { agentAttentionDecision } from '$lib/chat/domain/agent-attention';
import { AgentActivity } from './agent-activity.aggregate.svelte';

const base = {
	runId: 'run-1',
	sessionId: 'session-1',
	queueCount: 0,
	workstreamLabel: 'Homepage polish',
	repositoryFullName: 'szymeo/blog.dev',
	branch: 'malini/homepage',
	now: 42,
} as const;

describe('agentAttentionDecision', () => {
	it('notifies for the final completed turn in an inactive workstream', () => {
		expect(
			agentAttentionDecision({
				...base,
				event: { type: 'run.completed', runId: 'run-1', summary: 'Ready for review.' },
			}),
		).toEqual({
			kind: 'completed',
			runId: 'run-1',
			sessionId: 'session-1',
			updatedAt: 42,
			title: 'Homepage polish finished',
			body: 'Ready for review.',
		});
	});

	it('reads the turn report: an outcome alone finishes, a need asks for the user', () => {
		const report = [
			'![Sticky header](.malini/sandbox/screenshots/header.png)',
			'',
			'Outcome: The header stays pinned while the page scrolls.',
		];
		expect(
			agentAttentionDecision({
				...base,
				event: {
					type: 'run.completed',
					runId: 'run-1',
					summary: [...report, 'Needs: nothing'].join('\n'),
				},
			}),
		).toEqual({
			kind: 'completed',
			runId: 'run-1',
			sessionId: 'session-1',
			updatedAt: 42,
			title: 'Homepage polish finished',
			body: 'The header stays pinned while the page scrolls.',
		});
		expect(
			agentAttentionDecision({
				...base,
				event: {
					type: 'run.completed',
					runId: 'run-1',
					summary: [...report, 'Needs: Add R2_TOKEN to .env; Approve the copy'].join('\n'),
				},
			}),
		).toMatchObject({
			kind: 'input',
			title: 'Homepage polish needs you',
			body: 'Add R2_TOKEN to .env',
		});
	});

	it('suppresses intermediate queue completions', () => {
		const completed = { type: 'run.completed', runId: 'run-1', summary: 'Done.' } as const;
		expect(agentAttentionDecision({ ...base, queueCount: 1, event: completed })).toBeNull();
	});

	it('surfaces failures and approvals but ignores expected cancellation noise', () => {
		expect(
			agentAttentionDecision({
				...base,
				event: { type: 'run.failed', runId: 'run-1', error: 'tests failed' },
			})?.kind,
		).toBe('failed');
		expect(
			agentAttentionDecision({
				...base,
				event: { type: 'run.failed', runId: 'run-1', error: 'run cancelled' },
			}),
		).toBeNull();
		expect(
			agentAttentionDecision({
				...base,
				event: {
					type: 'approval.requested',
					runId: 'run-1',
					approvalId: 'approval-1',
					reason: 'Allow package install?',
				},
			})?.kind,
		).toBe('approval');
		expect(
			agentAttentionDecision({
				...base,
				event: {
					type: 'question.requested',
					runId: 'run-1',
					questionId: 'question-1',
					questions: [
						{
							id: 'question-1:0',
							prompt: 'Which test runner?',
							options: [{ label: 'Vitest' }],
							multiSelect: false,
							allowFreeText: true,
						},
					],
				},
			}),
		).toMatchObject({ kind: 'approval', body: 'Which test runner?' });
	});
});

describe('AgentActivity', () => {
	let activity: AgentActivity;

	beforeEach(() => {
		activity = new AgentActivity();
	});

	it('keeps a workstream unread while any of its chats is unread', () => {
		const finished = {
			kind: 'completed' as const,
			runId: 'run-1',
			sessionId: 'chat-1',
			updatedAt: 1,
		};
		const asking = { kind: 'input' as const, runId: 'run-2', sessionId: 'chat-2', updatedAt: 2 };
		expect(activity.mark('ws-1', finished)).toBe(true);
		expect(activity.mark('ws-1', finished)).toBe(false);
		activity.mark('ws-1', asking);

		expect(activity.unreadChatsIn('ws-1')).toEqual(['chat-1', 'chat-2']);
		expect(activity.attentionFor('ws-1')).toMatchObject(asking);

		expect(activity.clearChat('chat-2')).toBe(true);
		expect(activity.attentionForChat('chat-2')).toBeNull();
		expect(activity.attentionFor('ws-1')).toMatchObject(finished);

		activity.clearChat('chat-1');
		expect(activity.attentionFor('ws-1')).toBeNull();
	});

	it('leads with the chat that needs the user, then the latest one', () => {
		activity.mark('ws-1', { kind: 'failed', runId: 'run-1', sessionId: 'chat-1', updatedAt: 1 });
		activity.mark('ws-1', { kind: 'completed', runId: 'run-2', sessionId: 'chat-2', updatedAt: 3 });
		activity.mark('ws-1', { kind: 'approval', runId: 'run-3', sessionId: 'chat-3', updatedAt: 2 });

		expect(activity.attentionFor('ws-1')?.sessionId).toBe('chat-3');
	});

	it('only clears prior approval attention for the matching terminal run', () => {
		activity.mark('ws-1', {
			kind: 'approval',
			runId: 'run-new',
			sessionId: 'session-1',
			updatedAt: 2,
		});
		expect(activity.clearForRun('session-1', 'run-old')).toBe(false);
		expect(activity.attentionFor('ws-1')?.runId).toBe('run-new');
		expect(activity.clearForRun('session-1', 'run-new')).toBe(true);
		expect(activity.attentionFor('ws-1')).toBeNull();

		activity.mark('ws-1', {
			kind: 'completed',
			runId: 'run-new',
			sessionId: 'session-1',
			updatedAt: 3,
		});
		expect(activity.clearForRun('session-1', 'run-new')).toBe(false);
		expect(activity.attentionFor('ws-1')?.kind).toBe('completed');
	});

	it('tracks the registered workstream scope and prunes removed workstreams', () => {
		const alphaScope = [
			{
				workstreamId: 'stream-a',
				label: 'Alpha edit',
				repositoryFullName: 'bestboyhq/alpha',
				branch: 'malini/alpha',
			},
		] as const;
		expect(activity.registerWorkstreamScope(alphaScope)).toBe(true);
		expect(activity.registerWorkstreamScope(alphaScope)).toBe(false);
		expect(activity.registerWorkstreamScope([...alphaScope, ...alphaScope])).toBe(false);
		activity.registerWorkstreamScope([
			...alphaScope,
			{
				workstreamId: 'stream-b',
				label: 'Beta edit',
				repositoryFullName: 'bestboyhq/beta',
				branch: 'malini/beta',
			},
		]);
		activity.mark('stream-a', {
			kind: 'failed',
			runId: 'run-a',
			sessionId: 'session-a',
			updatedAt: 1,
		});

		expect(activity.workstreamIds()).toEqual(['stream-a', 'stream-b']);
		expect(activity.contextFor('stream-b')?.repositoryFullName).toBe('bestboyhq/beta');

		activity.registerWorkstreamScope([]);
		expect(activity.workstreamIds()).toEqual([]);
		expect(activity.attentionFor('stream-a')).toBeNull();
	});
});
