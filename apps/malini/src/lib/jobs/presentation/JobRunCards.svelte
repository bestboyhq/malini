<script lang="ts">
	import { onMount } from 'svelte';
	import { loadChatJobRunsCommand } from '$lib/jobs/application/commands/load-chat-job-runs.command';
	import { watchJobsHook } from '$lib/jobs/application/hooks/watch-jobs.hook';
	import { chatJobRunsQuery } from '$lib/jobs/application/queries/chat-job-runs.query.svelte';
	import JobRunCard from './JobRunCard.svelte';

	interface Props {
		chatSessionId: string;
		afterRunId: string | null;
		knownRunIds: readonly string[] | null;
	}

	let { chatSessionId, afterRunId, knownRunIds }: Props = $props();

	const chatRuns = $derived(chatJobRunsQuery.data(chatSessionId));
	const runs = $derived(
		chatRuns.filter(
			(run) =>
				run.chatAfterRunId === afterRunId ||
				(knownRunIds !== null &&
					run.chatAfterRunId !== null &&
					!knownRunIds.includes(run.chatAfterRunId)),
		),
	);

	onMount(() => {
		loadChatJobRunsCommand(chatSessionId);
		return watchJobsHook();
	});
</script>

{#if runs.length > 0}
	<li class="flex flex-col gap-2">
		{#each runs as run (run.id)}
			<JobRunCard {run} />
		{/each}
	</li>
{/if}
