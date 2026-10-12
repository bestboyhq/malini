<script lang="ts">
	import { onMount } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { LoadingCircle } from '$hyper-ui/components/loading-circle';
	import { avoidedByToasts, bottomOffsetClearOfAvoided } from '$hyper-ui/components/toast';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { loadJobsCommand } from '$lib/jobs/application/commands/load-jobs.command';
	import { watchJobsHook } from '$lib/jobs/application/hooks/watch-jobs.hook';
	import { activeJobRunsQuery } from '$lib/jobs/application/queries/active-job-runs.query.svelte';
	import { needsYouJobCountQuery } from '$lib/jobs/application/queries/needs-you-job-count.query.svelte';
	import { recentFinishedJobRunsQuery } from '$lib/jobs/application/queries/recent-finished-job-runs.query.svelte';
	import { runningJobCountQuery } from '$lib/jobs/application/queries/running-job-count.query.svelte';
	import { jobCenterSummary } from './job-center-summary';
	import JobRunList from './JobRunList.svelte';

	const EDGE_PX = 16;
	const HEADROOM_PX = 96;
	const CLEARANCE_POLL_MS = 250;

	let nowMs = $state(Date.now());
	let bottom = $state(EDGE_PX);

	const active = $derived(activeJobRunsQuery.data);
	const finished = $derived(recentFinishedJobRunsQuery.data(nowMs));
	const running = $derived(runningJobCountQuery.data);
	const needsYou = $derived(needsYouJobCountQuery.data);
	const visible = $derived(active.length + finished.length > 0);
	const summary = $derived(
		jobCenterSummary({
			running,
			needsYou,
			queued: active.length - running - needsYou,
			finished: finished.length,
		}),
	);

	onMount(() => {
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
		class="border-surface-elevated-border bg-surface-elevated fixed right-4 z-30 w-72 overflow-hidden rounded-xl border-[0.5px] shadow-lg"
		style:bottom={`${bottom}px`}
		style:--job-center-room={`calc(100vh - ${bottom + HEADROOM_PX}px)`}
		aria-label={`Jobs: ${summary}`}
		data-testid="job-center"
		{@attach avoidedByToasts}
		{@attach keepClearOfComposer}
	>
		<div class="flex items-center gap-0.5 p-1">
			<p class="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-xs" aria-hidden="true">
				<span class="text-fg-secondary grid size-4 shrink-0 place-items-center">
					{#if running > 0}
						<LoadingCircle size={12} />
					{:else if needsYou > 0}
						<Icon name="alert" size={13} class="text-warning-content" />
					{:else}
						<Icon name="checklist" size={13} />
					{/if}
				</span>
				<span class="min-w-0 flex-1 truncate">
					<span class="text-fg-default font-medium">Jobs</span>
					<span class={needsYou > 0 ? 'text-warning-content' : 'text-fg-tertiary'}>
						· {summary}
					</span>
				</span>
			</p>
			<Tooltip content="Manage jobs" placement="top">
				<IconButton variant="ghost" size="sm" href="/jobs" ariaLabel="Manage jobs">
					<Icon name="settings" size={13} />
				</IconButton>
			</Tooltip>
		</div>
		<div class="max-h-[var(--job-center-room)] overflow-y-auto px-1 pb-1">
			<JobRunList {active} {finished} {nowMs} />
		</div>
	</section>
{/if}
