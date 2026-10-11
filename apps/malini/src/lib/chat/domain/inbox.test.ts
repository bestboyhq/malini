import { describe, expect, it } from 'vitest';
import type { AgentAttention, AgentWorkstreamContext } from './agent-attention';
import { inbox } from './inbox';

function context(workstreamId: string): AgentWorkstreamContext {
	return {
		workstreamId,
		label: `${workstreamId} label`,
		repositoryFullName: `acme/${workstreamId}`,
		branch: `malini/${workstreamId}`,
	};
}

describe('the inbox', () => {
	it('puts what needs the user first, newest first, and keeps finished turns below', () => {
		const attentions: Record<string, AgentAttention> = {
			done: { kind: 'completed', runId: 'r1', updatedAt: 5 },
			asks: { kind: 'input', runId: 'r2', updatedAt: 2 },
			broke: { kind: 'failed', runId: 'r3', updatedAt: 3 },
			waits: { kind: 'approval', runId: 'r4', updatedAt: 1 },
			gone: { kind: 'input', runId: 'r5', updatedAt: 9 },
		};

		const result = inbox(attentions, (id) => (id === 'gone' ? null : context(id)));

		expect(result.needsYou.map((entry) => entry.workstreamId)).toEqual(['broke', 'asks', 'waits']);
		expect(result.done.map((entry) => entry.workstreamId)).toEqual(['done']);
		expect(result.done[0]).toMatchObject({ label: 'done label', repositoryFullName: 'acme/done' });
	});
});
