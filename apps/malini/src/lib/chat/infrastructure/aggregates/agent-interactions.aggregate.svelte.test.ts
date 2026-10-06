import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent, EventEnvelope } from '$lib/chat/domain/events';
import {
	agentInteractionKey,
	canPersistAgentApproval,
} from '$lib/chat/domain/agent-interaction-state';
import { AgentInteractionCommands } from './agent-interactions.aggregate.svelte';

function envelope(seq: number, event: AgentEvent): EventEnvelope {
	return { sessionId: 'session-1', runId: 'run-1', seq, event };
}

function approvalReference() {
	return {
		kind: 'approval' as const,
		sessionId: 'session-1',
		runId: 'run-1',
		requestId: 'approval-1',
	};
}

function externalReadApproval(): Extract<AgentEvent, { type: 'approval.requested' }> {
	return {
		type: 'approval.requested',
		runId: 'run-1',
		approvalId: 'approval-1',
		reason: 'Read an external reference',
		permission: {
			capability: 'read',
			resources: [
				{
					kind: 'path',
					value: '../reference/file.ts',
					canonicalValue: '/repo/reference/file.ts',
					boundary: 'external',
				},
			],
		},
	};
}

describe('AgentInteractionCommands', () => {
	it('correlates replay-shaped approvals through the envelope and prevents double submit/replay', async () => {
		let release!: (result: { decision: 'allow'; scope: 'session'; remembered: true }) => void;
		const gate = new Promise<{
			decision: 'allow';
			scope: 'session';
			remembered: true;
		}>((resolve) => {
			release = resolve;
		});
		const decideAgentApproval = vi.fn(() => gate);
		const onResolved = vi.fn();
		const commands = new AgentInteractionCommands(
			() => ({
				decideAgentApproval,
				answerAgentQuestion: vi.fn(),
			}),
			onResolved,
		);
		const replayShaped = envelope(1, externalReadApproval());
		commands.sync([replayShaped, { ...replayShaped, seq: 2 }]);

		const input = {
			sessionId: 'session-1',
			runId: 'run-1',
			approvalId: 'approval-1',
			decision: 'allow' as const,
			scope: 'session' as const,
		};
		const first = commands.decideApproval(input);
		await expect(commands.decideApproval(input)).resolves.toBe(false);
		expect(decideAgentApproval).toHaveBeenCalledTimes(1);
		expect(commands.stateFor(approvalReference())).toEqual({ status: 'submitting' });
		commands.sync([]);
		expect(commands.stateFor(approvalReference())).toEqual({ status: 'submitting' });
		release({ decision: 'allow', scope: 'session', remembered: true });
		await expect(first).resolves.toBe(true);
		expect(onResolved).toHaveBeenCalledWith('session-1', 'run-1');
		expect(decideAgentApproval).toHaveBeenCalledWith({
			...input,
			permission: externalReadApproval().permission,
		});
		expect(commands.stateFor(approvalReference())).toEqual({
			status: 'resolved',
			message: 'Allowed for this chat',
			decision: 'allow',
			requestedScope: 'session',
			scopeStored: true,
		});
		commands.sync([replayShaped, { ...replayShaped, seq: 3 }]);
		await expect(commands.decideApproval(input)).resolves.toBe(false);
		expect(decideAgentApproval).toHaveBeenCalledTimes(1);
	});

	it('blocks mismatched inner identity and approvals made stale by a terminal event', async () => {
		const decideAgentApproval = vi.fn();
		const commands = new AgentInteractionCommands(() => ({
			decideAgentApproval,
			answerAgentQuestion: vi.fn(),
		}));
		commands.sync([envelope(1, { ...externalReadApproval(), sessionId: 'another-session' })]);
		expect(commands.stateFor(approvalReference())).toMatchObject({ status: 'stale' });

		commands.reset();
		commands.sync([
			envelope(1, externalReadApproval()),
			envelope(2, { type: 'run.failed', runId: 'run-1', error: 'cancelled' }),
		]);
		expect(commands.stateFor(approvalReference())).toMatchObject({ status: 'stale' });
		await expect(
			commands.decideApproval({
				sessionId: 'session-1',
				runId: 'run-1',
				approvalId: 'approval-1',
				decision: 'allow',
				scope: 'once',
			}),
		).resolves.toBe(false);
		expect(decideAgentApproval).not.toHaveBeenCalled();
	});

	it('keeps a live request actionable while another retained transcript synchronizes', async () => {
		const decideAgentApproval = vi.fn().mockResolvedValue({
			decision: 'allow',
			scope: 'once',
			remembered: false,
		});
		const onResolved = vi.fn();
		const commands = new AgentInteractionCommands(
			() => ({ decideAgentApproval, answerAgentQuestion: vi.fn() }),
			onResolved,
		);
		commands.syncSession('session-1', [envelope(1, externalReadApproval())]);
		commands.syncSession('retained-session', [
			{
				sessionId: 'retained-session',
				runId: 'retained-run',
				seq: 1,
				event: { type: 'run.completed', runId: 'retained-run', summary: 'done' },
			},
		]);

		expect(commands.stateFor(approvalReference())).toEqual({ status: 'idle' });
		await expect(
			commands.decideApproval({
				sessionId: 'session-1',
				runId: 'run-1',
				approvalId: 'approval-1',
				decision: 'allow',
				scope: 'once',
			}),
		).resolves.toBe(true);
		expect(decideAgentApproval).toHaveBeenCalledTimes(1);
		expect(onResolved).toHaveBeenCalledWith('session-1', 'run-1');
	});

	it('leaves a denied run waiting, since the denial stops it', async () => {
		const decideAgentApproval = vi.fn().mockResolvedValue({
			decision: 'deny',
			scope: 'once',
			remembered: false,
		});
		const onResolved = vi.fn();
		const commands = new AgentInteractionCommands(
			() => ({ decideAgentApproval, answerAgentQuestion: vi.fn() }),
			onResolved,
		);
		commands.sync([envelope(1, externalReadApproval())]);

		await expect(
			commands.decideApproval({
				sessionId: 'session-1',
				runId: 'run-1',
				approvalId: 'approval-1',
				decision: 'deny',
				scope: 'once',
			}),
		).resolves.toBe(true);

		expect(onResolved).not.toHaveBeenCalled();
		expect(commands.stateFor(approvalReference())).toMatchObject({
			status: 'resolved',
			message: 'Denied',
			decision: 'deny',
		});
	});

	it('only offers and accepts broader scopes for canonical external reads', async () => {
		expect(canPersistAgentApproval(externalReadApproval().permission)).toBe(true);
		expect(
			canPersistAgentApproval({
				capability: 'execute',
				resources: [
					{
						kind: 'tool',
						value: 'computer_use:desktop',
						canonicalValue: 'computer_use:desktop',
						boundary: 'external',
					},
				],
			}),
		).toBe(false);
		expect(
			canPersistAgentApproval({
				capability: 'execute',
				resources: [{ kind: 'tool', value: 'bash', boundary: 'external' }],
			}),
		).toBe(false);
		expect(
			canPersistAgentApproval({
				capability: 'network',
				resources: [{ kind: 'url', value: 'https://example.com', boundary: 'external' }],
			}),
		).toBe(false);
		expect(
			canPersistAgentApproval({
				capability: 'read',
				resources: [
					{
						kind: 'path',
						value: '../reference',
						canonicalValue: '../reference',
						boundary: 'external',
					},
				],
			}),
		).toBe(false);

		const decideAgentApproval = vi.fn();
		const commands = new AgentInteractionCommands(() => ({
			decideAgentApproval,
			answerAgentQuestion: vi.fn(),
		}));
		commands.sync([
			envelope(1, {
				type: 'approval.requested',
				runId: 'run-1',
				approvalId: 'approval-1',
				reason: 'Fetch a URL',
				permission: {
					capability: 'network',
					resources: [{ kind: 'url', value: 'https://example.com', boundary: 'external' }],
				},
			}),
		]);
		await expect(
			commands.decideApproval({
				sessionId: 'session-1',
				runId: 'run-1',
				approvalId: 'approval-1',
				decision: 'allow',
				scope: 'workstream',
			}),
		).resolves.toBe(false);
		expect(decideAgentApproval).not.toHaveBeenCalled();
		expect(commands.stateFor(approvalReference())).toEqual({
			status: 'error',
			message: 'This permission can only be allowed once.',
		});
	});

	it('validates structured answers, surfaces adapter errors, and allows a safe retry', async () => {
		const answerAgentQuestion = vi
			.fn()
			.mockRejectedValueOnce(new Error('native bridge unavailable'))
			.mockResolvedValueOnce(undefined);
		const commands = new AgentInteractionCommands(() => ({
			decideAgentApproval: vi.fn(),
			answerAgentQuestion,
		}));
		commands.sync([
			envelope(1, {
				type: 'question.requested',
				runId: 'run-1',
				questionId: 'question-1',
				questions: [
					{
						id: 'question-1:0',
						prompt: 'Which runner?',
						options: [{ label: 'Vitest' }, { label: 'Playwright' }],
						multiSelect: false,
						allowFreeText: false,
					},
				],
			}),
		]);
		const reference = {
			kind: 'question' as const,
			sessionId: 'session-1',
			runId: 'run-1',
			requestId: 'question-1',
		};
		const unanswered = {
			sessionId: 'session-1',
			runId: 'run-1',
			questionId: 'question-1',
			answers: [],
		};
		await expect(commands.answerQuestion(unanswered)).resolves.toBe(false);
		expect(commands.stateFor(reference)).toMatchObject({ status: 'error' });
		const answered = {
			...unanswered,
			answers: [{ questionId: 'question-1:0', values: ['Vitest'] }],
		};
		await expect(commands.answerQuestion(answered)).resolves.toBe(false);
		expect(commands.stateFor(reference)).toEqual({
			status: 'error',
			message: 'native bridge unavailable',
		});
		await expect(commands.answerQuestion(answered)).resolves.toBe(true);
		expect(answerAgentQuestion).toHaveBeenCalledTimes(2);
		expect(commands.stateFor(reference)).toMatchObject({
			status: 'resolved',
			message: 'Answered',
		});
	});

	it('uses collision-safe keys across interaction kinds', () => {
		expect(agentInteractionKey(approvalReference())).not.toBe(
			agentInteractionKey({ ...approvalReference(), kind: 'question' }),
		);
	});
});
