<script lang="ts">
	import type { Snippet } from 'svelte';
	import { workstreamChatSummaryQuery } from '$lib/chat/application/queries/workstream-chat-summary.query.svelte';
	import type { WorkstreamChatSummary } from '$lib/chat/domain/workstream-chat-summary';

	interface Props {
		workstreamId: string;
		children: Snippet<[WorkstreamChatSummary]>;
	}

	let { workstreamId, children }: Props = $props();

	const summary = $derived(workstreamChatSummaryQuery.data(workstreamId));
</script>

{@render children(summary)}
