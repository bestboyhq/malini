import { describe, expect, it } from 'vitest';
import { agentAttentionDecision } from './agent-attention';

const BASE = {
	runId: 'run-1',
	sessionId: 'session-1',
	queueCount: 0,
	workstreamLabel: 'Search',
	repositoryFullName: 'acme/app',
	branch: 'malini/search',
	now: 1,
};

describe('agentAttentionDecision', () => {
	it('asks for no attention when a limit paused the turn, and for some when it failed', () => {
		const error = "You've hit your session limit";

		expect(
			agentAttentionDecision({
				...BASE,
				event: {
					type: 'run.failed',
					runId: 'run-1',
					error,
					failure: { kind: 'usage-limit', resetsAt: '2026-10-27T14:31:13.000Z' },
					resumeAt: '2026-10-27T14:31:18.000Z',
				},
			}),
		).toBeNull();
		expect(
			agentAttentionDecision({
				...BASE,
				event: { type: 'run.failed', runId: 'run-1', error, failure: { kind: 'billing' } },
			}),
		).toMatchObject({ kind: 'failed', title: 'Search needs attention' });
	});
});
