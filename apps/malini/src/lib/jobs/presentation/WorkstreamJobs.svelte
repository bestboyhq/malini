<script lang="ts">
	import { onMount } from 'svelte';
	import type { JobDefinitionRecord } from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { loadJobsCommand } from '$lib/jobs/application/commands/load-jobs.command';
	import { runJobCommand } from '$lib/jobs/application/commands/run-job.command';
	import { watchJobsHook } from '$lib/jobs/application/hooks/watch-jobs.hook';
	import { builtinJobDefinitionsQuery } from '$lib/jobs/application/queries/builtin-job-definitions.query.svelte';
	import { customJobDefinitionsQuery } from '$lib/jobs/application/queries/custom-job-definitions.query.svelte';
	import { jobActionStateQuery } from '$lib/jobs/application/queries/job-action-state.query.svelte';
	import { workstreamJobRunsQuery } from '$lib/jobs/application/queries/workstream-job-runs.query.svelte';
	import { isRunnableJob } from '$lib/jobs/domain/builtin-jobs';
	import { instructionsPreview } from './job-definition-copy';
	import JobRunCard from './JobRunCard.svelte';

	interface Props {
		workstreamId: string;
	}

	let { workstreamId }: Props = $props();

	const CLOCK_MS = 30_000;

	let nowMs = $state(Date.now());
	let startedId = $state<string | null>(null);

	const builtins = $derived(builtinJobDefinitionsQuery.data);
	const customs = $derived(customJobDefinitionsQuery.data);
	const actionState = $derived(jobActionStateQuery.data);
	const runs = $derived(workstreamJobRunsQuery.data(workstreamId, nowMs));
	const jobs = $derived([...builtins, ...customs].filter(isRunnableJob));
	const startError = $derived(startedId === null ? null : actionState(startedId).error);

	onMount(() => {
		loadJobsCommand();
		const releaseJobs = watchJobsHook();
		const clock = setInterval(() => (nowMs = Date.now()), CLOCK_MS);
		return () => {
			releaseJobs();
			clearInterval(clock);
		};
	});

	function onRun(job: JobDefinitionRecord): void {
		startedId = job.id;
		runJobCommand({ definitionId: job.id, workstreamId });
	}
</script>

{#if jobs.length > 0 || runs.length > 0}
	<section class="mt-6" aria-label="Jobs">
		{#if jobs.length > 0}
			<p class="text-2xs text-fg-tertiary">Run a job</p>
			<div class="mt-2 flex flex-wrap gap-2">
				{#each jobs as job (job.id)}
					<Tooltip content={instructionsPreview(job.instructions)} placement="top">
						<Button
							variant="secondary"
							size="sm"
							class="border-chip-border bg-chip hover:bg-surface-150-hover h-8 max-w-52 border-[1px] px-2.5 text-xs"
							ariaLabel={`Run ${job.name}`}
							loading={actionState(job.id).busy}
							onclick={() => onRun(job)}
						>
							<Icon name="play" size={12} />
							<span class="truncate">{job.name}</span>
						</Button>
					</Tooltip>
				{/each}
			</div>
		{/if}
		{#if startError}
			<p class="text-2xs text-error-content mt-2 flex items-start gap-1.5 leading-4" role="alert">
				<Icon name="alert" class="mt-px shrink-0" size={13} />
				<span class="min-w-0">{startError}</span>
			</p>
		{/if}
		{#if runs.length > 0}
			<ul class="mt-4 flex flex-col gap-2" aria-label="Jobs in this workstream">
				{#each runs as run (run.id)}
					<li><JobRunCard {run} /></li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}
