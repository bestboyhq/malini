import { describe, expect, it } from 'vitest';
import type { AgentAttention } from '$lib/chat/domain/agent-attention';
import type { WorkstreamChatSummary } from '$lib/chat/domain/workstream-chat-summary';
import { treeChatSummary } from './attention-tree';

function summary(attention: AgentAttention | null): WorkstreamChatSummary {
	return {
		sessionId: attention?.sessionId ?? null,
		queueCount: 0,
		attention,
		needsYou: attention !== null && attention.kind !== 'completed',
		hasDraft: false,
		state: null,
	};
}

function attention(kind: AgentAttention['kind'], sessionId: string): AgentAttention {
	return { kind, runId: `${sessionId}-run`, sessionId, updatedAt: 1 };
}

describe('attention tree', () => {
	it('quiets a workstream another workstream started', () => {
		expect(treeChatSummary(summary(attention('input', 'child')), [], true)).toMatchObject({
			attention: null,
			needsYou: false,
			attentionFromStarted: false,
		});
	});

	it('raises what the work a workstream started needs over what the workstream itself says', () => {
		const root = summary(attention('completed', 'root'));
		const raised = treeChatSummary(
			root,
			[summary(attention('approval', 'child')), summary(null)],
			false,
		);
		expect(raised).toMatchObject({
			sessionId: 'root',
			attention: { kind: 'approval', sessionId: 'child' },
			needsYou: true,
			attentionFromStarted: true,
		});
		expect(treeChatSummary(root, [summary(null)], false)).toMatchObject({
			attention: { kind: 'completed', sessionId: 'root' },
			needsYou: false,
			attentionFromStarted: false,
		});
	});
});
