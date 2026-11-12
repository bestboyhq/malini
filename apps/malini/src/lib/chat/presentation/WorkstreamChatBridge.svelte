<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { SessionStatus } from '$contract/agent-state-machine';
	import { workstreamAgentStatusQuery } from '$lib/chat/application/queries/workstream-agent-status.query.svelte';

	type WorkstreamChatSeams = Readonly<{
		agentStatus: SessionStatus | null;
	}>;

	interface Props {
		workstreamId: string;
		children: Snippet<[WorkstreamChatSeams]>;
	}

	let { workstreamId, children }: Props = $props();

	const agentStatus = $derived(workstreamAgentStatusQuery.data(workstreamId));

	const seams: WorkstreamChatSeams = {
		get agentStatus(): SessionStatus | null {
			return agentStatus;
		},
	};
</script>

{@render children(seams)}
