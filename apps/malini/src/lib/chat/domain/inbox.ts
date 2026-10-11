import {
	attentionNeedsUser,
	type AgentAttention,
	type AgentWorkstreamContext,
} from '$lib/chat/domain/agent-attention';

export type InboxEntry = Readonly<{
	workstreamId: string;
	label: string;
	repositoryFullName: string;
	attention: AgentAttention;
}>;

export type Inbox = Readonly<{
	needsYou: readonly InboxEntry[];
	done: readonly InboxEntry[];
}>;

export function inbox(
	attentionByWorkstream: Readonly<Record<string, AgentAttention>>,
	contextFor: (workstreamId: string) => AgentWorkstreamContext | null,
): Inbox {
	const entries = Object.entries(attentionByWorkstream)
		.flatMap(([workstreamId, attention]): InboxEntry[] => {
			const context = contextFor(workstreamId);
			if (!context) return [];
			return [
				{
					workstreamId,
					label: context.label,
					repositoryFullName: context.repositoryFullName,
					attention,
				},
			];
		})
		.sort((left, right) => right.attention.updatedAt - left.attention.updatedAt);
	return {
		needsYou: entries.filter((entry) => attentionNeedsUser(entry.attention)),
		done: entries.filter((entry) => !attentionNeedsUser(entry.attention)),
	};
}
