<script lang="ts">
	import type { Snippet } from 'svelte';
	import {
		workstreamAgentRunningQuery,
		type WorkstreamAgentWork,
	} from '$lib/chat/application/queries/workstream-agent-running.query.svelte';

	type WorkstreamChatSeams = Readonly<{
		agentWork: WorkstreamAgentWork | null;
	}>;

	interface Props {
		workstreamId: string;
		children: Snippet<[WorkstreamChatSeams]>;
	}

	let { workstreamId, children }: Props = $props();

	const agentWork = $derived(workstreamAgentRunningQuery.data(workstreamId));

	const seams: WorkstreamChatSeams = {
		get agentWork(): WorkstreamAgentWork | null {
			return agentWork;
		},
	};
</script>

{@render children(seams)}
