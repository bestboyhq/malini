import { readAgentAttentions, type AgentAttention } from '$lib/chat/domain/agent-attention';

const ATTENTION_KEY = 'malini.chat.attention:v1';

export const agentAttentionStorage = {
	read(): Record<string, AgentAttention> {
		try {
			const raw = globalThis.localStorage?.getItem(ATTENTION_KEY);
			return raw ? readAgentAttentions(JSON.parse(raw)) : {};
		} catch {
			return {};
		}
	},
	write(attentions: Readonly<Record<string, AgentAttention>>): void {
		try {
			globalThis.localStorage?.setItem(ATTENTION_KEY, JSON.stringify(attentions));
		} catch {}
	},
};
