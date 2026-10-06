import { beforeEach, describe, expect, it } from 'vitest';
import { agentAttentionDecision } from '$lib/chat/domain/agent-attention';
import { AgentActivity } from './agent-activity.aggregate.svelte';

const base = {
	runId: 'run-1',
	activeWorkstreamId: 'ws-active',
	workstreamId: 'ws-background',
	appFocused: true,
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
			updatedAt: 42,
			title: 'Homepage polish finished',
			body: 'Ready for review.',
		});
	});

	it('suppresses intermediate queue completions and work the user is already viewing', () => {
		const completed = { type: 'run.completed', runId: 'run-1', summary: 'Done.' } as const;
		expect(agentAttentionDecision({ ...base, queueCount: 1, event: completed })).toBeNull();
		expect(
			agentAttentionDecision({
				...base,
				workstreamId: 'ws-active',
				appFocused: true,
				event: completed,
			}),
		).toBeNull();
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

	it('deduplicates a run and clears attention when the workstream is opened', () => {
		const attention = { kind: 'completed' as const, runId: 'run-1', updatedAt: 1 };
		expect(activity.mark('ws-1', attention)).toBe(true);
		expect(activity.mark('ws-1', attention)).toBe(false);
		expect(activity.attentionFor('ws-1')).toEqual(attention);
		expect(activity.clear('ws-1')).toBe(true);
		expect(activity.attentionFor('ws-1')).toBeNull();
	});

	it('only clears prior approval attention for the matching terminal run', () => {
		activity.mark('ws-1', { kind: 'approval', runId: 'run-new', updatedAt: 2 });
		expect(activity.clearForRun('ws-1', 'run-old')).toBe(false);
		expect(activity.attentionFor('ws-1')?.runId).toBe('run-new');
		expect(activity.clearForRun('ws-1', 'run-new')).toBe(true);
		expect(activity.attentionFor('ws-1')).toBeNull();

		activity.mark('ws-1', { kind: 'completed', runId: 'run-new', updatedAt: 3 });
		expect(activity.clearForRun('ws-1', 'run-new')).toBe(false);
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
		activity.mark('stream-a', { kind: 'failed', runId: 'run-a', updatedAt: 1 });

		expect(activity.workstreamIds()).toEqual(['stream-a', 'stream-b']);
		expect(activity.contextFor('stream-b')?.repositoryFullName).toBe('bestboyhq/beta');

		activity.registerWorkstreamScope([]);
		expect(activity.workstreamIds()).toEqual([]);
		expect(activity.attentionFor('stream-a')).toBeNull();
	});
});
