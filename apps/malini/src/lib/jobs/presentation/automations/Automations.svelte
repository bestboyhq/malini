<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import type { JobDefinitionRecord, SaveJobDefinitionArgs } from '$contract/jobs';
	import type { JobTrigger } from '$contract/routines';
	import { Button } from '$hyper-ui/components/button';
	import { loadProviderCapabilitiesCommand } from '$shared/providers/providers.api';
	import {
		refreshWorkstreamsCommand,
		syncWorkstreamsHook,
	} from '$shared/repositories/repositories.api';
	import { loadJobsCommand } from '$lib/jobs/application/commands/load-jobs.command';
	import { watchJobsHook } from '$lib/jobs/application/hooks/watch-jobs.hook';
	import { builtinJobDefinitionsQuery } from '$lib/jobs/application/queries/builtin-job-definitions.query.svelte';
	import { customJobDefinitionsQuery } from '$lib/jobs/application/queries/custom-job-definitions.query.svelte';
	import { jobDefinitionByIdQuery } from '$lib/jobs/application/queries/job-definition-by-id.query.svelte';
	import { jobsLoadQuery } from '$lib/jobs/application/queries/jobs-load.query.svelte';
	import type { ActionState, AutomationsView } from './automations-state.svelte';
	import AutomationsActivity from './AutomationsActivity.svelte';
	import AutomationsOverview from './AutomationsOverview.svelte';
	import AutomationsRecipes from './AutomationsRecipes.svelte';
	import JobDetail from './JobDetail.svelte';

	interface Props {
		view: AutomationsView;
		selectedJobId: string | null;
		triggerOf: (jobId: string) => JobTrigger | null;
		triggerStateOf: (jobId: string) => ActionState;
		creating: ActionState & Readonly<{ completed: number }>;
		waitingCount: number;
		waiting: Snippet;
		ontrigger: (job: JobDefinitionRecord, trigger: JobTrigger | null) => void;
		oncreate: (job: Omit<SaveJobDefinitionArgs, 'id'>, trigger: JobTrigger | null) => void;
	}

	let {
		view,
		selectedJobId,
		triggerOf,
		triggerStateOf,
		creating,
		waitingCount,
		waiting,
		ontrigger,
		oncreate,
	}: Props = $props();

	const load = $derived(jobsLoadQuery.data);
	const builtins = $derived(builtinJobDefinitionsQuery.data);
	const custom = $derived(customJobDefinitionsQuery.data);
	const jobs = $derived<readonly JobDefinitionRecord[]>([...custom, ...builtins]);
	const selected = $derived(jobDefinitionByIdQuery.data(selectedJobId));

	onMount(() => {
		loadJobsCommand();
		refreshWorkstreamsCommand();
		loadProviderCapabilitiesCommand();
		const stopWatchingJobs = watchJobsHook();
		const stopSyncingWorkstreams = syncWorkstreamsHook();
		return () => {
			stopSyncingWorkstreams();
			stopWatchingJobs();
		};
	});
</script>

{#if load.state === 'error'}
	<div
		class="border-error-content/20 bg-error mx-auto mt-4 w-full max-w-[880px] rounded-xl border-[0.5px] px-4 py-3"
		role="alert"
	>
		<p class="text-error-content text-xs">{load.error}</p>
		<div class="mt-2">
			<Button variant="secondary" size="sm" onclick={() => loadJobsCommand()}>Retry</Button>
		</div>
	</div>
{:else if selected}
	{#key selected.id}
		<JobDetail
			job={selected}
			trigger={triggerOf(selected.id)}
			triggerState={triggerStateOf(selected.id)}
			ontrigger={(trigger) => ontrigger(selected, trigger)}
		/>
	{/key}
{:else if selectedJobId === null || load.state === 'ready'}
	{#if view === 'activity'}
		<AutomationsActivity {jobs} {waitingCount} {waiting} />
	{:else if view === 'recipes'}
		<AutomationsRecipes />
	{:else}
		<AutomationsOverview {jobs} {triggerOf} {triggerStateOf} {creating} {ontrigger} {oncreate} />
	{/if}
{/if}
