<script lang="ts">
	import { onMount } from 'svelte';
	import { loadJobsCommand } from '$lib/jobs/application/commands/load-jobs.command';
	import { watchJobsHook } from '$lib/jobs/application/hooks/watch-jobs.hook';
	import { workstreamJobRunsQuery } from '$lib/jobs/application/queries/workstream-job-runs.query.svelte';
	import JobRunCard from './JobRunCard.svelte';

	interface Props {
		workstreamId: string;
	}

	let { workstreamId }: Props = $props();

	const CLOCK_MS = 30_000;

	let nowMs = $state(Date.now());

	const runs = $derived(workstreamJobRunsQuery.data(workstreamId, nowMs));

	onMount(() => {
		loadJobsCommand();
		const releaseJobs = watchJobsHook();
		const clock = setInterval(() => (nowMs = Date.now()), CLOCK_MS);
		return () => {
			releaseJobs();
			clearInterval(clock);
		};
	});
</script>

{#if runs.length > 0}
	<section class="mt-6" aria-label="Jobs">
		<ul class="flex flex-col gap-2" aria-label="Jobs in this workstream">
			{#each runs as run (run.id)}
				<li><JobRunCard {run} /></li>
			{/each}
		</ul>
	</section>
{/if}
