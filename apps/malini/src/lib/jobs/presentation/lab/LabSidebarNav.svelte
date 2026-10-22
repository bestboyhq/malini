<script lang="ts">
	import { cubicOut } from 'svelte/easing';
	import { prefersReducedMotion } from 'svelte/motion';
	import { fly } from 'svelte/transition';
	import type { JobDefinitionRecord } from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { LoadingCircle } from '$hyper-ui/components/loading-circle';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { Icon, type IconName } from '$hyper-ui/icons';
	import { builtinJobDefinitionsQuery } from '$lib/jobs/application/queries/builtin-job-definitions.query.svelte';
	import { customJobDefinitionsQuery } from '$lib/jobs/application/queries/custom-job-definitions.query.svelte';
	import { jobRunsForDefinitionQuery } from '$lib/jobs/application/queries/job-runs-for-definition.query.svelte';
	import { labWaitingJobs } from './lab-activity';
	import LabLabelVariants from './LabLabelVariants.svelte';
	import { labState, type LabSection } from './lab-state.svelte';
	import { labIsManual, labTrigger } from './lab-triggers';

	interface Props {
		backHref: string;
		backLabel: string;
	}

	let { backHref, backLabel }: Props = $props();

	const SECTIONS: readonly Readonly<{ value: LabSection; label: string; icon: IconName }>[] = [
		{ value: 'overview', label: 'Overview', icon: 'sparkles' },
		{ value: 'activity', label: 'Activity', icon: 'clock' },
		{ value: 'recipes', label: 'Recipes', icon: 'gift' },
	];

	const builtins = $derived(builtinJobDefinitionsQuery.data);
	const custom = $derived(customJobDefinitionsQuery.data);
	const runsFor = $derived(jobRunsForDefinitionQuery.data);
	const jobs = $derived<readonly JobDefinitionRecord[]>([
		...labState.created,
		...custom,
		...builtins,
	]);
	const waiting = $derived(
		labWaitingJobs(jobs, labState.setupOf, labState.dismissed).length +
			jobs.flatMap((job) => runsFor(job.id)).filter((run) => run.status === 'needs-you').length,
	);

	function slideIn(node: HTMLElement): ReturnType<typeof fly> {
		return fly(node, {
			x: 24,
			duration: prefersReducedMotion.current ? 0 : 220,
			easing: cubicOut,
		});
	}
</script>

<div class="flex min-h-0 flex-1 flex-col" in:slideIn data-testid="jobs-lab-nav">
	<div class="px-2.5 pt-1">
		<Button bare href={backHref} class="sidebar-row text-fg-secondary w-full gap-1.5 px-2">
			<Icon name="chevron-left" size={14} />
			<span class="min-w-0 truncate">{backLabel}</span>
		</Button>
	</div>

	<nav class="flex flex-col gap-px px-2.5 pt-4" aria-label="Automations">
		<LabLabelVariants placement="sidebar" />
		{#each SECTIONS as section (section.value)}
			{@const current = labState.section === section.value}
			<Button
				bare
				{...current ? { ariaCurrent: 'page' as const } : {}}
				class={[
					'sidebar-row w-full gap-2 px-2',
					current ? 'sidebar-row-active' : 'text-fg-secondary',
				]}
				onclick={() => (labState.section = section.value)}
			>
				<Icon name={section.icon} size={16} class="shrink-0" />
				<span class="min-w-0 flex-1 truncate text-left">{section.label}</span>
				{#if section.value === 'activity' && waiting > 0}
					<span
						class="bg-warning text-warning-content text-2xs grid min-w-4 place-items-center rounded-full px-1 tabular-nums"
					>
						{waiting}
					</span>
				{/if}
			</Button>
		{/each}
	</nav>

	<h3 class="text-fg-tertiary px-4.5 pt-6 pb-2.5 text-xs font-medium">Your jobs</h3>
	<ScrollableDiv class="min-h-0 flex-1" ariaLabel="Your jobs">
		<ul class="flex flex-col gap-px px-2.5 pb-4">
			{#each jobs as job (job.id)}
				{@const setup = labState.setupOf(job)}
				{@const runs = runsFor(job.id)}
				{@const current = labState.selectedJobId === job.id}
				<li>
					<Button
						bare
						{...current ? { ariaCurrent: 'page' as const } : {}}
						class={[
							'sidebar-row w-full gap-2 px-2',
							current ? 'sidebar-row-active' : 'text-fg-secondary',
						]}
						onclick={() => (labState.selectedJobId = job.id)}
					>
						<Icon name={labTrigger(setup).icon} size={13} class="text-fg-tertiary shrink-0" />
						<span
							class={[
								'min-w-0 flex-1 truncate text-left',
								setup.mode === 'off' && !labIsManual(setup)
									? 'text-fg-tertiary'
									: 'text-fg-default',
							]}
						>
							{job.name}
						</span>
						{#if runs.some((run) => run.status === 'needs-you')}
							<Icon name="alert" size={12} class="text-warning-content shrink-0" />
						{:else if runs.some((run) => run.status === 'running')}
							<LoadingCircle size={11} />
						{:else if setup.mode === 'off' && !labIsManual(setup)}
							<span class="text-fg-tertiary text-2xs shrink-0">Off</span>
						{:else if setup.mode === 'ask' && !labIsManual(setup)}
							<span class="text-fg-tertiary text-2xs shrink-0">Asks</span>
						{/if}
					</Button>
				</li>
			{/each}
		</ul>
	</ScrollableDiv>
</div>
