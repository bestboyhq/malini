<script lang="ts">
	import { onMount } from 'svelte';
	import type { JobDefinitionRecord } from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { loadProviderCapabilitiesCommand } from '$shared/providers/providers.api';
	import {
		refreshWorkstreamsCommand,
		syncWorkstreamsHook,
	} from '$shared/repositories/repositories.api';
	import { loadJobSuggestionsCommand } from '$lib/jobs/application/commands/load-job-suggestions.command';
	import { loadJobsCommand } from '$lib/jobs/application/commands/load-jobs.command';
	import { watchJobsHook } from '$lib/jobs/application/hooks/watch-jobs.hook';
	import { builtinJobDefinitionsQuery } from '$lib/jobs/application/queries/builtin-job-definitions.query.svelte';
	import { customJobDefinitionsQuery } from '$lib/jobs/application/queries/custom-job-definitions.query.svelte';
	import { jobDefinitionByIdQuery } from '$lib/jobs/application/queries/job-definition-by-id.query.svelte';
	import { jobsLoadQuery } from '$lib/jobs/application/queries/jobs-load.query.svelte';
	import type { AutomationsView } from './automations-state.svelte';
	import AutomationsActivity from './AutomationsActivity.svelte';
	import AutomationsOverview from './AutomationsOverview.svelte';
	import AutomationsRecipes from './AutomationsRecipes.svelte';
	import JobDetail from './JobDetail.svelte';

	interface Props {
		view: AutomationsView;
		selectedJobId: string | null;
	}

	let { view, selectedJobId }: Props = $props();

	const load = $derived(jobsLoadQuery.data);
	const builtins = $derived(builtinJobDefinitionsQuery.data);
	const custom = $derived(customJobDefinitionsQuery.data);
	const jobs = $derived<readonly JobDefinitionRecord[]>([...custom, ...builtins]);
	const selected = $derived(jobDefinitionByIdQuery.data(selectedJobId));

	onMount(() => {
		loadJobsCommand();
		loadJobSuggestionsCommand();
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
		<JobDetail job={selected} {jobs} />
	{/key}
{:else if selectedJobId === null || load.state === 'ready'}
	{#if view === 'activity'}
		<AutomationsActivity {jobs} />
	{:else if view === 'recipes'}
		<AutomationsRecipes />
	{:else}
		<AutomationsOverview {jobs} />
	{/if}
{/if}
