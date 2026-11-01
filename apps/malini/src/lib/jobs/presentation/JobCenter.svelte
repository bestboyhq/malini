<script lang="ts">
	import { onMount } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import { Button } from '$hyper-ui/components/button';
	import { avoidedByToasts, bottomOffsetClearOfAvoided } from '$hyper-ui/components/toast';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { JOBS_HREF } from '$shared/router/routes-hrefs';
	import { loadJobsCommand } from '$lib/jobs/application/commands/load-jobs.command';
	import { watchJobsHook } from '$lib/jobs/application/hooks/watch-jobs.hook';
	import { activeJobRunsQuery } from '$lib/jobs/application/queries/active-job-runs.query.svelte';
	import { needsYouJobCountQuery } from '$lib/jobs/application/queries/needs-you-job-count.query.svelte';
	import { recentFinishedJobRunsQuery } from '$lib/jobs/application/queries/recent-finished-job-runs.query.svelte';
	import { runningJobCountQuery } from '$lib/jobs/application/queries/running-job-count.query.svelte';
	import { upcomingScheduledJobsQuery } from '$lib/jobs/application/queries/upcoming-scheduled-jobs.query.svelte';
	import { waitingForYouJobCountQuery } from '$lib/jobs/application/queries/waiting-for-you-job-count.query.svelte';
	import { jobCenterSummary } from './job-center-summary';
	import JobRunList from './JobRunList.svelte';
	import UpcomingJobs from './UpcomingJobs.svelte';

	interface Props {
		docked?: boolean;
	}

	let { docked = false }: Props = $props();

	const EDGE_PX = 12;
	const HEADROOM_PX = 96;
	const CLEARANCE_POLL_MS = 250;
	const RUNS_TICK_MS = 1_000;
	const UPCOMING_TICK_MS = 60_000;

	let nowMs = $state(Date.now());
	let bottom = $state(EDGE_PX);

	const active = $derived(activeJobRunsQuery.data);
	const finished = $derived(recentFinishedJobRunsQuery.data(nowMs));
	const running = $derived(runningJobCountQuery.data);
	const needsYouRuns = $derived(needsYouJobCountQuery.data);
	const needsYou = $derived(waitingForYouJobCountQuery.data);
	const upcoming = $derived(upcomingScheduledJobsQuery.data(nowMs));
	const hasRuns = $derived(active.length + finished.length > 0);
	const hasUpcoming = $derived(upcoming.length > 0);
	const tickMs = $derived(hasRuns ? RUNS_TICK_MS : hasUpcoming ? UPCOMING_TICK_MS : null);
	const summary = $derived(
		jobCenterSummary(
			{
				running,
				needsYou,
				queued: active.length - running - needsYouRuns,
				finished: finished.length,
				nextAt: upcoming[0]?.nextAt ?? null,
			},
			nowMs,
		),
	);

	onMount(() => {
		loadJobsCommand();
		return watchJobsHook();
	});

	$effect(() => {
		if (tickMs === null) return;
		nowMs = Date.now();
		const clock = setInterval(() => (nowMs = Date.now()), tickMs);
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

{#if docked || hasRuns || hasUpcoming || needsYou > 0}
	<section
		class={[
			'border-surface-50-border bg-surface-50 flex flex-col overflow-hidden rounded-3xl border-[0.5px] p-2',
			docked
				? 'relative z-10 mt-auto mr-3 mb-3 max-h-1/2 shrink-0 contain-inline-size'
				: 'shadow-popup fixed right-3 z-30 max-h-[var(--job-center-room)] w-72',
		]}
		style:bottom={docked ? undefined : `${bottom}px`}
		style:--job-center-room={docked ? undefined : `calc(100vh - ${bottom + HEADROOM_PX}px)`}
		aria-label={`Jobs: ${summary}`}
		data-testid="job-center"
		{@attach avoidedByToasts}
		{@attach !docked && keepClearOfComposer}
	>
		<Button
			bare
			href={JOBS_HREF}
			class="group hover:bg-surface-50-hover focus-visible:ring-border-default/50 flex h-8 w-full shrink-0 cursor-pointer items-center gap-2 rounded-xl px-2 text-left text-xs outline-none focus-visible:ring-2"
			data-testid="job-center-open-jobs"
		>
			<span class="text-fg-secondary grid size-4 shrink-0 place-items-center" aria-hidden="true">
				{#if running > 0}
					<BusyIcon size={12} />
				{:else if needsYou > 0}
					<Icon name="dot" size={13} class="text-brand-icon" />
				{:else}
					<Icon name="checklist" size={13} />
				{/if}
			</span>
			<span class="min-w-0 flex-1 truncate">
				<span class="text-fg-default font-medium">Jobs</span>
				<span class={needsYou > 0 ? 'text-brand-foreground' : 'text-fg-tertiary'}>
					· {summary}
				</span>
			</span>
			<Icon
				name="chevron-right"
				size={12}
				class="text-fg-tertiary group-hover:text-fg-default shrink-0"
			/>
		</Button>
		<div class="min-h-0 overflow-y-auto">
			<JobRunList {active} {finished} {nowMs} />
			<UpcomingJobs jobs={upcoming} {nowMs} />
		</div>
	</section>
{/if}
