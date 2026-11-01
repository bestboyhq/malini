<script lang="ts">
	import { onMount } from 'svelte';
	import { avoidedByToasts } from '$hyper-ui/components/toast';
	import type { JobCenterEntry } from '$lib/jobs/domain/job-center';
	import JobRunList from './JobRunList.svelte';

	interface Props {
		entries: readonly JobCenterEntry[];
		workstreamId: string;
	}

	let { entries, workstreamId }: Props = $props();

	let nowMs = $state(Date.now());

	onMount(() => {
		const clock = setInterval(() => (nowMs = Date.now()), 1_000);
		return () => clearInterval(clock);
	});
</script>

<section
	{@attach avoidedByToasts}
	aria-label={`Jobs (${entries.length})`}
	data-testid="workstream-job-runs"
>
	<div class="max-h-60 overflow-y-auto p-1">
		<JobRunList {entries} {nowMs} shownIn={workstreamId} asksHere />
	</div>
</section>
