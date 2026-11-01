<script lang="ts">
	import { quartOut } from 'svelte/easing';
	import { slide } from 'svelte/transition';
	import { asksYou, type JobCenterEntry } from '$lib/jobs/domain/job-center';
	import JobQuestionLink from './JobQuestionLink.svelte';
	import JobQuestionRow from './JobQuestionRow.svelte';
	import JobRunRow from './JobRunRow.svelte';

	interface Props {
		entries: readonly JobCenterEntry[];
		nowMs: number;
		shownIn?: string | null;
		asksHere?: boolean;
	}

	let { entries, nowMs, shownIn = null, asksHere = false }: Props = $props();

	const foldDuration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 240;
</script>

<ul aria-label="Jobs in progress" class={[asksHere && 'flex flex-col gap-1']}>
	{#each entries as entry (entry.key)}
		<li transition:slide={{ duration: foldDuration, easing: quartOut }}>
			{#if asksYou(entry) && asksHere && entry.run?.status !== 'needs-you'}
				<JobQuestionRow {entry} {nowMs} {shownIn} />
			{:else if asksYou(entry)}
				<JobQuestionLink {entry} {shownIn} />
			{:else if entry.run}
				<JobRunRow run={entry.run} {nowMs} {shownIn} />
			{/if}
		</li>
	{/each}
</ul>
