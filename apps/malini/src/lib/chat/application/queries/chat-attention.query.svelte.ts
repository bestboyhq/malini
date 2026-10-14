import type { AgentAttention } from '$lib/chat/domain/agent-attention';
import { agentActivity } from '$lib/chat/infrastructure/aggregates/agent-activity.aggregate.svelte';

export { chatAttentionQuery };

class ChatAttentionQuery {
	public readonly data: (sessionId: string) => AgentAttention | null = $derived((sessionId) =>
		agentActivity.attentionForChat(sessionId),
	);
}

const chatAttentionQuery = new ChatAttentionQuery();
