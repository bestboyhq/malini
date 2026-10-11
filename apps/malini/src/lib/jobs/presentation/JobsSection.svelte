<script lang="ts">
	import { onMount } from 'svelte';
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
	import { jobFormSubmissionQuery } from '$lib/jobs/application/queries/job-form-submission.query.svelte';
	import { jobsLoadQuery } from '$lib/jobs/application/queries/jobs-load.query.svelte';
	import JobDefinitionForm from './JobDefinitionForm.svelte';
	import JobDefinitionRow from './JobDefinitionRow.svelte';

	let editTarget = $state<Readonly<{ definitionId: string; saves: number }> | null>(null);
	let formElement = $state<HTMLElement | null>(null);

	const load = $derived(jobsLoadQuery.data);
	const custom = $derived(customJobDefinitionsQuery.data);
	const builtins = $derived(builtinJobDefinitionsQuery.data);
	const saves = $derived(jobFormSubmissionQuery.data.saves);
	const editingId = $derived(editTarget?.saves === saves ? editTarget.definitionId : null);
	const editing = $derived(jobDefinitionByIdQuery.data(editingId));
	const formKey = $derived(`${editing?.id ?? 'new'}:${saves}`);

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

	function onEdit(definitionId: string): void {
		editTarget = { definitionId, saves };
		formElement?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	}
</script>

<section class="space-y-10" aria-label="Jobs" data-testid="jobs-section">
	{#if load.state === 'error'}
		<div class="border-error-content/20 bg-error rounded-lg border px-3 py-2.5" role="alert">
			<p class="text-error-content text-xs">{load.error}</p>
			<div class="mt-2">
				<Button variant="secondary" size="2xs" onclick={() => loadJobsCommand()}>Retry</Button>
			</div>
		</div>
	{/if}

	<section class="space-y-3" aria-labelledby="jobs-yours-heading">
		<div>
			<h2 id="jobs-yours-heading" class="text-fg-default text-base font-semibold tracking-tight">
				Your jobs
				{#if custom.length > 0}
					<span class="text-fg-tertiary font-normal">({custom.length})</span>
				{/if}
			</h2>
			<p class="text-fg-tertiary mt-1 text-xs">
				Run one in a workstream you pick, or in a new one.
			</p>
		</div>
		{#if custom.length === 0}
			<p class="text-fg-tertiary text-xs">
				{load.state === 'ready' ? 'No jobs of your own yet. Build one below.' : ''}
			</p>
		{:else}
			<ul class="space-y-2" aria-label="Your jobs">
				{#each custom as definition (definition.id)}
					<JobDefinitionRow {definition} editing={definition.id === editingId} onedit={onEdit} />
				{/each}
			</ul>
		{/if}
	</section>

	{#if builtins.length > 0}
		<section class="space-y-3" aria-labelledby="jobs-builtin-heading">
			<div>
				<h2
					id="jobs-builtin-heading"
					class="text-fg-default text-base font-semibold tracking-tight"
				>
					Built-in jobs
				</h2>
				<p class="text-fg-tertiary mt-1 text-xs">
					The merge queue runs these to get a pull request merged. Edit how they work; Reset brings
					back the original.
				</p>
			</div>
			<ul class="space-y-2" aria-label="Built-in jobs">
				{#each builtins as definition (definition.id)}
					<JobDefinitionRow {definition} editing={definition.id === editingId} onedit={onEdit} />
				{/each}
			</ul>
		</section>
	{/if}

	<section class="space-y-3" aria-labelledby="job-form-heading" bind:this={formElement}>
		<div>
			<h2 id="job-form-heading" class="text-fg-default text-base font-semibold tracking-tight">
				{editing ? `Edit ${editing.name}` : 'New job'}
			</h2>
			<p class="text-fg-tertiary mt-1 text-xs">
				Say what the agent should do, pick its model, and choose what happens when it finishes.
			</p>
		</div>
		{#key formKey}
			<JobDefinitionForm definition={editing} oncancel={() => (editTarget = null)} />
		{/key}
	</section>
</section>
