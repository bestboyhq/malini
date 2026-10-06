<script lang="ts">
	import WorkstreamChatSummary from '../WorkstreamChatSummary.svelte';

	interface Props {
		workstreamIds: readonly string[];
	}

	let { workstreamIds }: Props = $props();
</script>

{#each workstreamIds as workstreamId (workstreamId)}
	<WorkstreamChatSummary {workstreamId}>
		{#snippet children(chat)}
			<p
				data-testid="workstream-chat-summary"
				data-workstream-id={workstreamId}
				data-session-id={chat.sessionId ?? ''}
				data-queue-count={chat.queueCount}
				data-draft={chat.hasDraft ? 'true' : 'false'}
				data-attention={chat.attention?.kind ?? ''}
				data-tone={chat.state?.tone ?? ''}
			>
				{chat.state?.label ?? 'Idle'}
			</p>
		{/snippet}
	</WorkstreamChatSummary>
{/each}
