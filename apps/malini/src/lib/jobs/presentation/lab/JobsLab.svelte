<script lang="ts">
	import { onMount } from 'svelte';
	import type { JobDefinitionRecord } from '$contract/jobs';
	import { loadProviderCapabilitiesCommand } from '$shared/providers/providers.api';
	import {
		refreshWorkstreamsCommand,
		syncWorkstreamsHook,
	} from '$shared/repositories/repositories.api';
	import { loadJobsCommand } from '$lib/jobs/application/commands/load-jobs.command';
	import { watchJobsHook } from '$lib/jobs/application/hooks/watch-jobs.hook';
	import { builtinJobDefinitionsQuery } from '$lib/jobs/application/queries/builtin-job-definitions.query.svelte';
	import { customJobDefinitionsQuery } from '$lib/jobs/application/queries/custom-job-definitions.query.svelte';
	import { LAB_LOCAL_JOB_PREFIX, labState } from './lab-state.svelte';
	import LabActivityPage from './LabActivityPage.svelte';
	import LabJobDetail from './LabJobDetail.svelte';
	import LabOverview from './LabOverview.svelte';
	import LabRecipesPage from './LabRecipesPage.svelte';

	const builtins = $derived(builtinJobDefinitionsQuery.data);
	const custom = $derived(customJobDefinitionsQuery.data);
	const jobs = $derived<readonly JobDefinitionRecord[]>([
		...labState.created,
		...custom,
		...builtins,
	]);
	const selected = $derived(jobs.find((job) => job.id === labState.selectedJobId) ?? null);

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

<main class="flex h-full min-h-0 p-2" data-testid="jobs-lab">
	<div
		class="bg-surface-50 border-surface-50-border flex min-w-0 flex-1 flex-col overflow-hidden rounded-3xl border-[0.5px]"
	>
		{#if labState.section === 'activity'}
			<LabActivityPage {jobs} />
		{:else if labState.section === 'recipes'}
			<LabRecipesPage />
		{:else}
			<LabOverview {jobs} />
		{/if}
	</div>
</main>

{#if selected}
	<LabJobDetail
		job={selected}
		setup={labState.setupOf(selected)}
		editable={!selected.id.startsWith(LAB_LOCAL_JOB_PREFIX)}
		onsetup={(next) => labState.setSetup(selected, next)}
		onclose={() => (labState.selectedJobId = null)}
	/>
{/if}
