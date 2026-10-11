<script lang="ts">
	import type { Snippet } from 'svelte';
	import { workstreamAgentRunningQuery } from '$lib/chat/application/queries/workstream-agent-running.query.svelte';

	type WorkstreamChatSeams = Readonly<{
		agentRunning: boolean;
	}>;

	interface Props {
		workstreamId: string;
		children: Snippet<[WorkstreamChatSeams]>;
	}

	let { workstreamId, children }: Props = $props();

	const agentRunning = $derived(workstreamAgentRunningQuery.data(workstreamId));

	const seams: WorkstreamChatSeams = {
		get agentRunning(): boolean {
			return agentRunning;
		},
	};
</script>

{@render children(seams)}
