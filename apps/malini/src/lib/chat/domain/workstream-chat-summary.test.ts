import { describe, expect, it } from 'vitest';
import type { AgentAttentionKind } from './agent-attention';
import { summarizeWorkstreamChat } from './workstream-chat-summary';

function summary(kind: AgentAttentionKind): ReturnType<typeof summarizeWorkstreamChat> {
	return summarizeWorkstreamChat({
		session: null,
		jobRunning: false,
		queueCount: 0,
		attention: { kind, runId: 'run-1', updatedAt: 1 },
		hasDraft: false,
	});
}

describe('the unread mark of a workstream', () => {
	it('names a turn that needs the user as waiting on them', () => {
		expect(summary('input').state).toEqual({ label: 'Needs you', tone: 'waiting' });
	});

	it('marks only the turns that need the user, never a turn that simply finished', () => {
		expect(summary('input').needsYou).toBe(true);
		expect(summary('approval').needsYou).toBe(true);
		expect(summary('failed').needsYou).toBe(true);
		expect(summary('completed').needsYou).toBe(false);
		expect(summary('completed').state).toEqual({ label: 'Ready', tone: 'completed' });
	});
});
