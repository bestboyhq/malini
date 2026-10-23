<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$shared/router/state';
	import { Automations, AutomationsSection } from '$lib/jobs/jobs.api';
	import { RoutinesSection, WaitingRoutineRuns } from '$lib/routines/routines.api';
	import { createTriggeredJobCommand } from '$lib/routines/application/commands/create-triggered-job.command';
	import { loadRoutinesCommand } from '$lib/routines/application/commands/load-routines.command';
	import { setJobTriggerCommand } from '$lib/routines/application/commands/set-job-trigger.command';
	import { watchRoutinesHook } from '$lib/routines/application/hooks/watch-routines.hook';
	import { jobTriggerStateQuery } from '$lib/routines/application/queries/job-trigger-state.query.svelte';
	import { jobTriggersQuery } from '$lib/routines/application/queries/job-triggers.query.svelte';
	import { newJobStateQuery } from '$lib/routines/application/queries/new-job-state.query.svelte';
	import { pendingGatedRunCountQuery } from '$lib/routines/application/queries/pending-gated-run-count.query.svelte';
	import { jobsView } from '../jobs-view';

	const TITLES = {
		overview: 'Automations',
		activity: 'Activity',
		recipes: 'Recipes',
		routines: 'Routines',
	} as const;

	const view = $derived(jobsView(page.route.id));
	const selectedJobId = $derived(page.params.jobId ?? null);
	const triggerOf = $derived(jobTriggersQuery.data);
	const triggerStateOf = $derived(jobTriggerStateQuery.data);
	const creating = $derived(newJobStateQuery.data);
	const waitingCount = $derived(pendingGatedRunCountQuery.data);

	onMount(() => {
		loadRoutinesCommand();
		return watchRoutinesHook();
	});
</script>

<svelte:head>
	<title>Malini · {TITLES[view]}</title>
</svelte:head>

<main class="flex h-full min-h-0 p-2" data-testid="jobs-page">
	<div
		class="bg-surface-50 border-surface-50-border flex min-w-0 flex-1 flex-col overflow-hidden rounded-3xl border-[0.5px]"
	>
		{#if view === 'routines'}
			<AutomationsSection
				title="Routines"
				description="Steps that run in order when a trigger fires. A routine earns trust from draft to candidate to routine."
				testId="automations-routines"
			>
				<RoutinesSection />
			</AutomationsSection>
		{:else}
			<Automations
				{view}
				{selectedJobId}
				{triggerOf}
				{triggerStateOf}
				{creating}
				{waitingCount}
				ontrigger={(job, trigger) => setJobTriggerCommand(job, trigger)}
				oncreate={(job, trigger) => createTriggeredJobCommand(job, trigger)}
			>
				{#snippet waiting()}
					<WaitingRoutineRuns />
				{/snippet}
			</Automations>
		{/if}
	</div>
</main>
