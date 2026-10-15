<script lang="ts">
	import { onMount } from 'svelte';
	import type { JobRunRecord } from '$contract/jobs';
	import { avoidedByToasts } from '$hyper-ui/components/toast';
	import { Icon } from '$hyper-ui/icons';
	import JobRunRow from './JobRunRow.svelte';

	interface Props {
		runs: readonly JobRunRecord[];
	}

	let { runs }: Props = $props();

	let nowMs = $state(Date.now());

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
	<header class="text-fg-secondary flex h-8 items-center gap-2 px-3 text-xs">
		<span class="text-fg-tertiary grid w-4 shrink-0 place-items-center" aria-hidden="true">
			<Icon name="checklist" size={12} />
		</span>
		<span class="min-w-0 flex-1 truncate">
			{runs.length}
			{runs.length === 1 ? 'job' : 'jobs'} in this workstream
		</span>
	</header>
	<ul class="max-h-48 overflow-y-auto px-1 pb-1">
		{#each runs as run (run.id)}
			<li><JobRunRow {run} {nowMs} showPlace={false} /></li>
		{/each}
	</ul>
</section>
