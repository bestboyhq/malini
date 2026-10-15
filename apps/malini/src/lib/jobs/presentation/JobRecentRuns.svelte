<script lang="ts">
	import { jobRunsForDefinitionQuery } from '$lib/jobs/application/queries/job-runs-for-definition.query.svelte';
	import JobRunRow from './JobRunRow.svelte';

	interface Props {
		definitionId: string;
	}

	let { definitionId }: Props = $props();

	const RECENT_RUNS = 10;

	let nowMs = $state(Date.now());

	const runs = $derived(jobRunsForDefinitionQuery.data(definitionId).slice(0, RECENT_RUNS));

	$effect(() => {
		if (runs.length === 0) return;
		const clock = setInterval(() => (nowMs = Date.now()), 1_000);
		return () => clearInterval(clock);
	});
</script>

<section class="flex flex-col gap-2" aria-labelledby="job-recent-runs-heading">
	<h3 id="job-recent-runs-heading" class="text-fg-default text-sm font-medium">Recent runs</h3>
	{#if runs.length > 0}
		<ul class="-mx-2 flex flex-col" aria-label="Recent runs">
			{#each runs as run (run.id)}
				<li><JobRunRow {run} {nowMs} placeFirst /></li>
			{/each}
		</ul>
	{:else}
		<p class="text-fg-tertiary text-xs leading-5">
			No runs yet. Run it from here, or type / in any chat.
		</p>
	{/if}
</section>
