<script lang="ts">
	import { cubicOut } from 'svelte/easing';
	import { prefersReducedMotion } from 'svelte/motion';
	import { fly } from 'svelte/transition';
	import type { JobDefinitionRecord } from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { BusyIcon, Icon, type IconName } from '$hyper-ui/icons';
	import {
		JOBS_ACTIVITY_HREF,
		JOBS_HREF,
		JOBS_RECIPES_HREF,
		jobHref,
	} from '$shared/router/routes-hrefs';
	import { builtinJobDefinitionsQuery } from '$lib/jobs/application/queries/builtin-job-definitions.query.svelte';
	import { customJobDefinitionsQuery } from '$lib/jobs/application/queries/custom-job-definitions.query.svelte';
	import { jobRunsForDefinitionQuery } from '$lib/jobs/application/queries/job-runs-for-definition.query.svelte';
	import { waitingForYouJobCountQuery } from '$lib/jobs/application/queries/waiting-for-you-job-count.query.svelte';
	import type { AutomationsView } from './automations-state.svelte';
	import { jobTriggerLook } from './triggers';

	interface Props {
		backHref: string;
		backLabel: string;
		view: AutomationsView;
		selectedJobId: string | null;
	}

	let { backHref, backLabel, view, selectedJobId }: Props = $props();

	const SECTIONS: readonly Readonly<{
		value: AutomationsView;
		label: string;
		icon: IconName;
		href: string;
	}>[] = [
		{ value: 'overview', label: 'Overview', icon: 'sparkles', href: JOBS_HREF },
		{ value: 'activity', label: 'Activity', icon: 'clock', href: JOBS_ACTIVITY_HREF },
		{ value: 'recipes', label: 'Recipes', icon: 'gift', href: JOBS_RECIPES_HREF },
	];

	const builtins = $derived(builtinJobDefinitionsQuery.data);
	const custom = $derived(customJobDefinitionsQuery.data);
	const runsFor = $derived(jobRunsForDefinitionQuery.data);
	const jobs = $derived<readonly JobDefinitionRecord[]>([...custom, ...builtins]);
	const waiting = $derived(waitingForYouJobCountQuery.data);

	function slideIn(node: HTMLElement): ReturnType<typeof fly> {
		return fly(node, {
			x: 24,
			duration: prefersReducedMotion.current ? 0 : 220,
			easing: cubicOut,
		});
	}
</script>

<div class="flex min-h-0 flex-1 flex-col" in:slideIn data-testid="automations-nav">
	<div class="px-2.5 pt-1">
		<Button bare href={backHref} class="sidebar-row text-fg-secondary w-full gap-1.5 px-2">
			<Icon name="chevron-left" size={14} />
			<span class="min-w-0 truncate">{backLabel}</span>
		</Button>
	</div>

	<nav class="flex flex-col gap-px px-2.5 pt-4" aria-label="Automations">
		<h2 class="text-fg-tertiary px-2 pt-1 pb-2.5 text-xs font-medium">Automations</h2>
		{#each SECTIONS as section (section.value)}
			{@const current = selectedJobId === null && view === section.value}
			<Button
				bare
				href={section.href}
				{...current ? { ariaCurrent: 'page' as const } : {}}
				class={[
					'sidebar-row w-full gap-2 px-2',
					current ? 'sidebar-row-active' : 'text-fg-secondary',
				]}
			>
				<Icon name={section.icon} size={16} class="shrink-0" />
				<span class="min-w-0 flex-1 truncate text-left">{section.label}</span>
				{#if section.value === 'activity' && waiting > 0}
					<span
						class="bg-warning text-warning-content text-2xs grid min-w-4 place-items-center rounded-full px-1 tabular-nums"
					>
						{waiting}
						<span class="sr-only">waiting for you</span>
					</span>
				{/if}
			</Button>
		{/each}
	</nav>

	<h3 class="text-fg-tertiary px-4.5 pt-6 pb-2.5 text-xs font-medium">Your jobs</h3>
	<ScrollableDiv class="min-h-0 flex-1" ariaLabel="Your jobs">
		<ul class="flex flex-col gap-px px-2.5 pb-4">
			{#each jobs as job (job.id)}
				{@const runs = runsFor(job.id)}
				{@const current = selectedJobId === job.id}
				{@const off = job.trigger?.mode === 'off'}
				<li>
					<Button
						bare
						href={jobHref(job.id)}
						{...current ? { ariaCurrent: 'page' as const } : {}}
						class={[
							'sidebar-row w-full gap-2 px-2',
							current ? 'sidebar-row-active' : 'text-fg-secondary',
						]}
					>
						<Icon name={jobTriggerLook(job).icon} size={13} class="text-fg-tertiary shrink-0" />
						<span
							class={[
								'min-w-0 flex-1 truncate text-left',
								off ? 'text-fg-tertiary' : 'text-fg-default',
							]}
						>
							{job.name}
						</span>
						{#if runs.some((run) => run.status === 'needs-you' || run.status === 'waiting')}
							<Icon name="alert" size={12} class="text-warning-content shrink-0" />
							<span class="sr-only">Needs you</span>
						{:else if runs.some((run) => run.status === 'running')}
							<BusyIcon size={11} />
							<span class="sr-only">Running</span>
						{:else if off}
							<span class="text-fg-tertiary text-2xs shrink-0">Off</span>
						{:else if job.trigger?.mode === 'ask'}
							<span class="text-fg-tertiary text-2xs shrink-0">Asks</span>
						{/if}
					</Button>
				</li>
			{/each}
		</ul>
	</ScrollableDiv>
</div>
