<script lang="ts">
	import type { PullRequestActionInput } from '@malini-extension/repository';
	import WorkstreamChatBridge from '../WorkstreamChatBridge.svelte';

	type Seams = Readonly<{
		submitAutomatedPrompt(prompt: string): Promise<void>;
		chatEvidence(): PullRequestActionInput;
	}>;

	interface Props {
		workstreamId: string;
		onseams: (seams: Seams) => void;
	}

	let { workstreamId, onseams }: Props = $props();
</script>

<WorkstreamChatBridge {workstreamId}>
	{#snippet children(chat)}
		{onseams(chat)}
	{/snippet}
</WorkstreamChatBridge>
