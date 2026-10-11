<script lang="ts">
	import { onMount } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import { avoidedByToasts, bottomOffsetClearOfAvoided } from '$hyper-ui/components/toast';
	import { hydrateJobCenterVariantCommand } from '$lib/jobs/application/commands/hydrate-job-center-variant.command';
	import { loadJobsCommand } from '$lib/jobs/application/commands/load-jobs.command';
	import { watchJobsHook } from '$lib/jobs/application/hooks/watch-jobs.hook';
	import { activeJobRunsQuery } from '$lib/jobs/application/queries/active-job-runs.query.svelte';
	import { jobCenterVariantQuery } from '$lib/jobs/application/queries/job-center-variant.query.svelte';
	import { needsYouJobCountQuery } from '$lib/jobs/application/queries/needs-you-job-count.query.svelte';
	import { recentFinishedJobRunsQuery } from '$lib/jobs/application/queries/recent-finished-job-runs.query.svelte';
	import { runningJobCountQuery } from '$lib/jobs/application/queries/running-job-count.query.svelte';
	import { jobCenterSummary } from './job-center-summary';
	import JobCenterDocked from './JobCenterDocked.svelte';
	import JobCenterPill from './JobCenterPill.svelte';
	import JobCenterStack from './JobCenterStack.svelte';

	const EDGE_PX = 16;
	const HEADROOM_PX = 96;
	const CLEARANCE_POLL_MS = 250;

	let nowMs = $state(Date.now());
	let bottom = $state(EDGE_PX);

	const variant = $derived(jobCenterVariantQuery.data);
	const active = $derived(activeJobRunsQuery.data);
	const finished = $derived(recentFinishedJobRunsQuery.data(nowMs));
	const running = $derived(runningJobCountQuery.data);
	const needsYou = $derived(needsYouJobCountQuery.data);
	const visible = $derived(active.length + finished.length > 0);
	const counts = $derived({
		running,
		needsYou,
		queued: active.length - running - needsYou,
		finished: finished.length,
	});
	const summary = $derived(jobCenterSummary(counts));

	onMount(() => {
		hydrateJobCenterVariantCommand();
		loadJobsCommand();
		return watchJobsHook();
	});

	$effect(() => {
		if (!visible) return;
		const clock = setInterval(() => (nowMs = Date.now()), 1_000);
		return () => clearInterval(clock);
	});

	const keepClearOfComposer: Attachment<HTMLElement> = (node) => {
		const keepClear = (): void => {
			const box = node.getBoundingClientRect();
			bottom = bottomOffsetClearOfAvoided({ left: box.left, right: box.right }, EDGE_PX, node);
		};
		keepClear();
		// ponytail: polls the toast-avoided surfaces (composer, changed files) every 250 ms; observe them directly if the lag ever shows.
		const poll = setInterval(keepClear, CLEARANCE_POLL_MS);
		window.addEventListener('resize', keepClear);
		return () => {
			clearInterval(poll);
			window.removeEventListener('resize', keepClear);
		};
	};
</script>

{#if visible}
	<section
		class="fixed right-4 z-30 flex flex-col items-end"
		style:bottom={`${bottom}px`}
		style:--job-center-room={`calc(100vh - ${bottom + HEADROOM_PX}px)`}
		aria-label="Jobs"
		data-testid="job-center"
		data-variant={variant}
		{@attach avoidedByToasts}
		{@attach keepClearOfComposer}
	>
		{#if variant === 'docked'}
			<JobCenterDocked {active} {finished} {nowMs} {counts} {summary} />
		{:else if variant === 'stack'}
			<JobCenterStack {active} {finished} {nowMs} {summary} />
		{:else}
			<JobCenterPill {active} {finished} {nowMs} {counts} {summary} />
		{/if}
	</section>
{/if}
