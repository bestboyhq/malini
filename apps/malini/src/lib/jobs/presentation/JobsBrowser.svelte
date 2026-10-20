<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
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
	import JobDetail from './JobDetail.svelte';
	import JobEditor from './JobEditor.svelte';
	import JobList from './JobList.svelte';

	interface Props {
		selectedJobId: string | null;
		creating: boolean;
	}

	let { selectedJobId, creating }: Props = $props();

	const load = $derived(jobsLoadQuery.data);
	const builtins = $derived(builtinJobDefinitionsQuery.data);
	const custom = $derived(customJobDefinitionsQuery.data);
	const chosen = $derived(jobDefinitionByIdQuery.data(selectedJobId));
	const selected = $derived(creating ? null : (chosen ?? builtins[0] ?? custom[0] ?? null));

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

<div class="flex min-h-0 flex-1" data-testid="jobs-browser">
	<JobList selectedId={selected?.id ?? null} {creating} />
	<ScrollableDiv class="min-w-0 flex-1" ariaLabel="Job">
		{#if load.state === 'error'}
			<div class="mx-auto w-full max-w-[720px] px-8 pt-1" role="alert">
				<p class="text-error-content text-xs">{load.error}</p>
				<div class="mt-2">
					<Button variant="secondary" size="sm" onclick={() => loadJobsCommand()}>Retry</Button>
				</div>
			</div>
		{:else if creating}
			<article
				class="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-8 pt-1 pb-16"
				aria-labelledby="job-new-heading"
				data-testid="job-new"
			>
				<header>
					<h2 id="job-new-heading" class="text-fg-default text-lg font-semibold tracking-tight">
						New job
					</h2>
					<p class="text-fg-tertiary mt-1 text-xs leading-5">
						Say what the agent should do, pick its model, and choose what happens when it finishes.
						Then run it from any chat with /.
					</p>
				</header>
				<JobEditor definition={null} />
			</article>
		{:else if selected}
			<JobDetail definition={selected} />
		{/if}
	</ScrollableDiv>
</div>
