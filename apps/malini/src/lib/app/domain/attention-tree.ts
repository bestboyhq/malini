import { attentionNeedsUser, mostPressingAttention } from '$lib/chat/domain/agent-attention';
import type { WorkstreamChatSummary } from '$lib/chat/domain/workstream-chat-summary';

export type TreeChatSummary = WorkstreamChatSummary & Readonly<{ attentionFromStarted: boolean }>;

export function treeChatSummary(
	own: WorkstreamChatSummary,
	started: readonly WorkstreamChatSummary[],
	underRoot: boolean,
): TreeChatSummary {
	if (underRoot) return { ...own, attention: null, needsYou: false, attentionFromStarted: false };
	const attention = mostPressingAttention(
		[own, ...started].flatMap((summary) => summary.attention ?? []),
	);
	return {
		...own,
		attention,
		needsYou: attentionNeedsUser(attention),
		attentionFromStarted: attention !== null && attention.sessionId !== own.attention?.sessionId,
	};
}
