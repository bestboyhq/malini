<script lang="ts">
	import { onMount } from 'svelte';
	import { quartOut } from 'svelte/easing';
	import { slide } from 'svelte/transition';
	import type { JobRunRecord } from '$contract/jobs';
	import { avoidedByToasts } from '$hyper-ui/components/toast';
	import JobRunRow from './JobRunRow.svelte';

	interface Props {
		runs: readonly JobRunRecord[];
	}

	let { runs }: Props = $props();

	let nowMs = $state(Date.now());
	const foldDuration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 240;

	onMount(() => {
		const clock = setInterval(() => (nowMs = Date.now()), 1_000);
		return () => clearInterval(clock);
	});
</script>

<section
	{@attach avoidedByToasts}
	aria-label={`Jobs in this workstream (${runs.length})`}
	data-testid="workstream-job-runs"
>
	<ul class="max-h-40 overflow-y-auto p-1">
		{#each runs as run (run.id)}
			<li transition:slide={{ duration: foldDuration, easing: quartOut }}>
				<JobRunRow {run} {nowMs} inWorkstream />
			</li>
		{/each}
	</ul>
</section>
