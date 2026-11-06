<script lang="ts">
	import { onMount } from 'svelte';
	import type {
		OneShotAutomationBuiltin,
		AutomationDefinitionRecord,
		AutomationExperimentRecord,
	} from '$contract/automations';
	import { Button } from '$hyper-ui/components/button';
	import { Well } from '$hyper-ui/components/well';
	import { Icon } from '$hyper-ui/icons';
	import { providerGroupsQuery, selectionLabel } from '$shared/providers/providers.api';
	import { automationHref } from '$shared/router/routes-hrefs';
	import { addAutomationExperimentCommand } from '$lib/automations/application/commands/add-automation-experiment.command';
	import { deleteAutomationExperimentCommand } from '$lib/automations/application/commands/delete-automation-experiment.command';
	import { openAutomationExperimentsCommand } from '$lib/automations/application/commands/open-automation-experiments.command';
	import { runAllAutomationExperimentsCommand } from '$lib/automations/application/commands/run-all-automation-experiments.command';
	import { runAutomationExperimentCommand } from '$lib/automations/application/commands/run-automation-experiment.command';
	import { selectAutomationExperimentCommand } from '$lib/automations/application/commands/select-automation-experiment.command';
	import { useAutomationExperimentCommand } from '$lib/automations/application/commands/use-automation-experiment.command';
	import { automationActionStateQuery } from '$lib/automations/application/queries/automation-action-state.query.svelte';
	import { automationExperimentsErrorQuery } from '$lib/automations/application/queries/automation-experiments-error.query.svelte';
	import { automationExperimentsQuery } from '$lib/automations/application/queries/automation-experiments.query.svelte';
	import { newAutomationExperimentStateQuery } from '$lib/automations/application/queries/new-automation-experiment-state.query.svelte';
	import { selectedAutomationExperimentQuery } from '$lib/automations/application/queries/selected-automation-experiment.query.svelte';
	import { brokeRuleCount } from '$lib/automations/domain/automation-output-checks';
	import { PageSection } from '$hyper-ui/components/page-section';
	import ExperimentCard from './ExperimentCard.svelte';
	import ExperimentResults from './ExperimentResults.svelte';
	import ExperimentSetup from './ExperimentSetup.svelte';
	import { instructionsLabel } from './automation-insights-copy';

	interface Props {
		automation: AutomationDefinitionRecord;
		builtin: OneShotAutomationBuiltin;
	}

	let { automation, builtin }: Props = $props();

	const session = $derived(automationExperimentsQuery.data(automation.id));
	const selected = $derived(selectedAutomationExperimentQuery.data(automation.id));
	const loadError = $derived(automationExperimentsErrorQuery.data(automation.id));
	const adding = $derived(newAutomationExperimentStateQuery.data(automation.id));
	const actionState = $derived(automationActionStateQuery.data);
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
		openAutomationExperimentsCommand(automation.id);
	});

	function score(experiment: AutomationExperimentRecord): number | null {
		if (experiment.running || sample.length === 0) return null;
		if (experiment.results.length < sample.length) return null;
		return brokeRuleCount(
			builtin,
			experiment.results.map((result) => result.output),
		);
	}

	function setupLabel(experiment: AutomationExperimentRecord): string {
		return `${selectionLabel(providerGroupsQuery.data, experiment)} · ${instructionsLabel(builtin, experiment.instructions)}`;
	}
</script>

<PageSection
	title={`Improve ${automation.name}`}
	description={`Try instructions and models on its last ${sample.length} ${sample.length === 1 ? 'run' : 'runs'}. Nothing changes until you use one.`}
>
	{#snippet eyebrow()}
		<Button
			bare
			href={automationHref(automation.id)}
			class="text-fg-tertiary hover:text-fg-secondary mb-1 flex items-center gap-1 text-xs"
		>
			<Icon name="chevron-left" size={12} />
			{automation.name}
		</Button>
	{/snippet}
	{#snippet actions()}
		{#if usable && selected}
			<Button
				variant="primary"
				size="sm"
				loading={selectedState?.busy ?? false}
				onclick={() => useAutomationExperimentCommand(selected)}
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
				Nothing to replay yet. {automation.name} keeps every name it gives, so come back once it has named
				a few.
			</p>
		</Well>
	{:else if session}
		<Well title="Experiments">
			{#snippet trailing()}
				<Button
					variant="ghost"
					size="sm"
					disabled={experiments.every((experiment) => experiment.running)}
					onclick={() => runAllAutomationExperimentsCommand(automation.id)}
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
							onselect={() => selectAutomationExperimentCommand(experiment)}
							onrerun={() => runAutomationExperimentCommand(experiment)}
							ondelete={() => deleteAutomationExperimentCommand(experiment)}
						/>
					</li>
				{/each}
				<li class="flex">
					<Button
						bare
						disabled={adding.busy || selected === null}
						onclick={() => {
							if (selected) addAutomationExperimentCommand(selected);
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
</PageSection>
