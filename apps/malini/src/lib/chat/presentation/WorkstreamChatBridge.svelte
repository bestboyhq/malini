<script lang="ts">
	import type { Snippet } from 'svelte';
	import { workstreamAgentRunningQuery } from '$lib/chat/application/queries/workstream-agent-running.query.svelte';

	type WorkstreamChatSeams = Readonly<{
		agentWorking: boolean;
	}>;

	interface Props {
		workstreamId: string;
		children: Snippet<[WorkstreamChatSeams]>;
	}

	let { workstreamId, children }: Props = $props();

	const agentWorking = $derived(workstreamAgentRunningQuery.data(workstreamId));

	const seams: WorkstreamChatSeams = {
		get agentWorking(): boolean {
			return agentWorking;
		},
	};
</script>

{@render children(seams)}
