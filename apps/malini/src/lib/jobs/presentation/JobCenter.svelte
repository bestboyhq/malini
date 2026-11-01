<script lang="ts">
	import { onMount } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import { Button } from '$hyper-ui/components/button';
	import { avoidedByToasts, bottomOffsetClearOfAvoided } from '$hyper-ui/components/toast';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { JOBS_HREF } from '$shared/router/routes-hrefs';
	import { loadJobsCommand } from '$lib/jobs/application/commands/load-jobs.command';
	import { watchJobsHook } from '$lib/jobs/application/hooks/watch-jobs.hook';
	import { jobCenterEntriesQuery } from '$lib/jobs/application/queries/job-center-entries.query.svelte';
	import { jobCenterCounts } from '$lib/jobs/domain/job-center';
	import { jobCenterSummary } from './job-center-summary';
	import JobRunList from './JobRunList.svelte';

	interface Props {
		docked?: boolean;
	}

	let { docked = false }: Props = $props();

	const EDGE_PX = 12;
	const HEADROOM_PX = 96;
	const CLEARANCE_POLL_MS = 250;
	const TICK_MS = 1_000;

	let nowMs = $state(Date.now());
	let bottom = $state(EDGE_PX);

	const entries = $derived(jobCenterEntriesQuery.data);
	const counts = $derived(jobCenterCounts(entries));
	const summary = $derived(jobCenterSummary(counts));
	const live = $derived(entries.length > 0);

	onMount(() => {
		loadJobsCommand();
		return watchJobsHook();
	});

	$effect(() => {
		if (!live) return;
		nowMs = Date.now();
		const clock = setInterval(() => (nowMs = Date.now()), TICK_MS);
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

{#if docked || live}
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
				{#if counts.running > 0}
					<BusyIcon size={12} />
				{:else if counts.needsYou > 0}
					<Icon name="dot" size={13} class="text-brand-icon" />
				{:else}
					<Icon name="checklist" size={13} />
				{/if}
			</span>
			<span class="min-w-0 flex-1 truncate">
				<span class="text-fg-default font-medium">Jobs</span>
				<span class={counts.needsYou > 0 ? 'text-brand-foreground' : 'text-fg-tertiary'}>
					· {summary}
				</span>
			</span>
			<Icon
				name="chevron-right"
				size={12}
				class="text-fg-tertiary group-hover:text-fg-default shrink-0"
			/>
		</Button>
		{#if live}
			<div class="min-h-0 overflow-y-auto">
				<JobRunList {entries} {nowMs} />
			</div>
		{/if}
	</section>
{/if}
