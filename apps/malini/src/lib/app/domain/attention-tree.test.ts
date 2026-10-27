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
	it('quiets a workstream another chat leads', () => {
		expect(treeChatSummary(summary(attention('input', 'child')), [], true)).toMatchObject({
			attention: null,
			needsYou: false,
			attentionFromStarted: false,
		});
	});

	it('raises what the work a chat started needs over what the chat itself says', () => {
		const lead = summary(attention('completed', 'lead'));
		const raised = treeChatSummary(
			lead,
			[summary(attention('approval', 'child')), summary(null)],
			false,
		);
		expect(raised).toMatchObject({
			sessionId: 'lead',
			attention: { kind: 'approval', sessionId: 'child' },
			needsYou: true,
			attentionFromStarted: true,
		});
		expect(treeChatSummary(lead, [summary(null)], false)).toMatchObject({
			attention: { kind: 'completed', sessionId: 'lead' },
			needsYou: false,
			attentionFromStarted: false,
		});
	});
});
