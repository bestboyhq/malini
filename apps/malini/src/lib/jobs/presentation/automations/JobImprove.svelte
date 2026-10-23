<script lang="ts">
	import { onMount } from 'svelte';
	import type {
		AutomaticJobBuiltin,
		JobDefinitionRecord,
		JobExperimentRecord,
	} from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { Well } from '$hyper-ui/components/well';
	import { Icon } from '$hyper-ui/icons';
	import { catalogModelLabel, modelCatalogQuery } from '$shared/providers/providers.api';
	import { jobHref } from '$shared/router/routes-hrefs';
	import { addJobExperimentCommand } from '$lib/jobs/application/commands/add-job-experiment.command';
	import { deleteJobExperimentCommand } from '$lib/jobs/application/commands/delete-job-experiment.command';
	import { openJobExperimentsCommand } from '$lib/jobs/application/commands/open-job-experiments.command';
	import { runAllJobExperimentsCommand } from '$lib/jobs/application/commands/run-all-job-experiments.command';
	import { runJobExperimentCommand } from '$lib/jobs/application/commands/run-job-experiment.command';
	import { selectJobExperimentCommand } from '$lib/jobs/application/commands/select-job-experiment.command';
	import { useJobExperimentCommand } from '$lib/jobs/application/commands/use-job-experiment.command';
	import { jobActionStateQuery } from '$lib/jobs/application/queries/job-action-state.query.svelte';
	import { jobExperimentsErrorQuery } from '$lib/jobs/application/queries/job-experiments-error.query.svelte';
	import { jobExperimentsQuery } from '$lib/jobs/application/queries/job-experiments.query.svelte';
	import { newJobExperimentStateQuery } from '$lib/jobs/application/queries/new-job-experiment-state.query.svelte';
	import { selectedJobExperimentQuery } from '$lib/jobs/application/queries/selected-job-experiment.query.svelte';
	import { brokeRuleCount } from '$lib/jobs/domain/job-output-checks';
	import AutomationsSection from './AutomationsSection.svelte';
	import ExperimentCard from './ExperimentCard.svelte';
	import ExperimentResults from './ExperimentResults.svelte';
	import ExperimentSetup from './ExperimentSetup.svelte';
	import { instructionsLabel } from './job-insights-copy';

	interface Props {
		job: JobDefinitionRecord;
		builtin: AutomaticJobBuiltin;
	}

	let { job, builtin }: Props = $props();

	const session = $derived(jobExperimentsQuery.data(job.id));
	const selected = $derived(selectedJobExperimentQuery.data(job.id));
	const loadError = $derived(jobExperimentsErrorQuery.data(job.id));
	const adding = $derived(newJobExperimentStateQuery.data(job.id));
	const actionState = $derived(jobActionStateQuery.data);
	const catalog = $derived(modelCatalogQuery.data);
	const sample = $derived(session?.sample ?? []);
	const experiments = $derived(session?.experiments ?? []);
	const scores = $derived(
		new Map(experiments.map((experiment) => [experiment.id, score(experiment)])),
	);
	const best = $derived(
		Math.min(
			...[...scores.values()].filter((broke): broke is number => broke !== null),
			Number.POSITIVE_INFINITY,
		),
	);
	const selectedState = $derived(selected ? actionState(selected.id) : null);
	const selectedScore = $derived(selected ? (scores.get(selected.id) ?? null) : null);
	const usable = $derived(
		selected !== null && !selected.current && !selected.running && selectedScore !== null,
	);
	const errors = $derived(
		[loadError, adding.error, selectedState?.error ?? null].filter(
			(error): error is string => error !== null,
		),
	);

	onMount(() => {
		openJobExperimentsCommand(job.id);
	});

	function score(experiment: JobExperimentRecord): number | null {
		if (experiment.running || sample.length === 0) return null;
		if (experiment.results.length < sample.length) return null;
		return brokeRuleCount(
			builtin,
			experiment.results.map((result) => result.output),
		);
	}

	function setupLabel(experiment: JobExperimentRecord): string {
		return `${catalogModelLabel(catalog, experiment.model)} · ${instructionsLabel(builtin, experiment.instructions)}`;
	}
</script>

<AutomationsSection
	title={`Improve ${job.name}`}
	description={`Try instructions and models on its last ${sample.length} ${sample.length === 1 ? 'run' : 'runs'}. Nothing changes until you use one.`}
>
	{#snippet eyebrow()}
		<Button
			bare
			href={jobHref(job.id)}
			class="text-fg-tertiary hover:text-fg-secondary mb-1 flex items-center gap-1 text-xs"
		>
			<Icon name="chevron-left" size={12} />
			{job.name}
		</Button>
	{/snippet}
	{#snippet actions()}
		{#if usable && selected}
			<Button
				variant="primary"
				size="sm"
				loading={selectedState?.busy ?? false}
				onclick={() => useJobExperimentCommand(selected)}
			>
				{#snippet leading()}
					<Icon name="check" size={12} />
				{/snippet}
				Use {selected.name}
			</Button>
		{/if}
	{/snippet}

	{#each errors as error (error)}
		<p
			class="border-error-content/20 bg-error text-error-content rounded-xl border-[0.5px] px-4 py-3 text-xs"
			role="alert"
		>
			{error}
		</p>
	{/each}

	{#if session && sample.length === 0}
		<Well title="Experiments">
			<p
				class="border-surface-50-border bg-surface-50 text-fg-tertiary rounded-xl border-[0.5px] px-4 py-3 text-xs"
			>
				Nothing to replay yet. {job.name} keeps every name it gives, so come back once it has named a
				few.
			</p>
		</Well>
	{:else if session}
		<Well title="Experiments">
			{#snippet trailing()}
				<Button
					variant="ghost"
					size="sm"
					disabled={experiments.every((experiment) => experiment.running)}
					onclick={() => runAllJobExperimentsCommand(job.id)}
				>
					{#snippet leading()}
						<Icon name="refresh" size={12} />
					{/snippet}
					Run all again
				</Button>
			{/snippet}
			<ul class="grid grid-cols-2 gap-1.5 @2xl:grid-cols-4" aria-label="Experiments">
				{#each experiments as experiment (experiment.id)}
					<li class="flex">
						<ExperimentCard
							{experiment}
							setup={setupLabel(experiment)}
							broke={scores.get(experiment.id) ?? null}
							best={scores.get(experiment.id) === best}
							sampleSize={sample.length}
							selected={experiment.id === selected?.id}
							busy={actionState(experiment.id).busy}
							onselect={() => selectJobExperimentCommand(experiment)}
							onrerun={() => runJobExperimentCommand(experiment)}
							ondelete={() => deleteJobExperimentCommand(experiment)}
						/>
					</li>
				{/each}
				<li class="flex">
					<Button
						bare
						disabled={adding.busy || selected === null}
						onclick={() => {
							if (selected) addJobExperimentCommand(selected);
						}}
						class="border-surface-50-border text-fg-tertiary hover:bg-surface-50-hover hover:text-fg-secondary flex min-h-24 w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed text-xs"
					>
						<Icon name="plus" size={14} />
						New experiment
					</Button>
				</li>
			</ul>
		</Well>

		{#if selected}
			<Well title={selected.current ? 'Today’s setup' : `${selected.name} setup`}>
				<div class="border-surface-50-border bg-surface-50 rounded-xl border-[0.5px]">
					{#key selected.id}
						<ExperimentSetup
							experiment={selected}
							complete={selectedScore !== null}
							sampleSize={sample.length}
							busy={selectedState?.busy ?? false}
						/>
					{/key}
				</div>
			</Well>
		{/if}

		<Well title={`Results on its last ${sample.length} ${sample.length === 1 ? 'run' : 'runs'}`}>
			<ExperimentResults {builtin} {sample} {experiments} selectedId={selected?.id ?? null} />
		</Well>
	{/if}
</AutomationsSection>
