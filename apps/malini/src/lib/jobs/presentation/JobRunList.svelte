<script lang="ts">
	import { quartOut } from 'svelte/easing';
	import { slide } from 'svelte/transition';
	import { asksYou, type JobCenterEntry } from '$lib/jobs/domain/job-center';
	import JobQuestionRow from './JobQuestionRow.svelte';
	import JobRunRow from './JobRunRow.svelte';

	interface Props {
		entries: readonly JobCenterEntry[];
		nowMs: number;
		shownIn?: string | null;
	}

	let { entries, nowMs, shownIn = null }: Props = $props();

	const foldDuration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 240;
</script>

<ul aria-label="Jobs in progress">
	{#each entries as entry (entry.key)}
		<li transition:slide={{ duration: foldDuration, easing: quartOut }}>
			{#if asksYou(entry)}
				<JobQuestionRow {entry} {nowMs} {shownIn} />
			{:else if entry.run}
				<JobRunRow run={entry.run} {nowMs} {shownIn} />
			{/if}
		</li>
	{/each}
</ul>
