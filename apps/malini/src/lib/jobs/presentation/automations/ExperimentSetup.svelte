<script lang="ts">
	import type { JobExperimentRecord } from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { Select, type SelectOption } from '$hyper-ui/components/select';
	import { Textarea } from '$hyper-ui/components/textarea';
	import { Icon } from '$hyper-ui/icons';
	import { catalogModelLabel, modelCatalogQuery } from '$shared/providers/providers.api';
	import { changeJobExperimentCommand } from '$lib/jobs/application/commands/change-job-experiment.command';
	import { runJobExperimentCommand } from '$lib/jobs/application/commands/run-job-experiment.command';
	import { JOB_INSTRUCTIONS_MAX_LENGTH } from '$lib/jobs/domain/job-definition';

	interface Props {
		experiment: JobExperimentRecord;
		complete: boolean;
		sampleSize: number;
		busy: boolean;
	}

	let { experiment, complete, sampleSize, busy }: Props = $props();

	let draft = $state(startingDraft());

	const catalog = $derived(modelCatalogQuery.data);
	const modelOptions: SelectOption[] = $derived([
		...catalog.map((model) => ({ value: model.id, label: catalogModelLabel(catalog, model.id) })),
		...(catalog.some((model) => model.id === experiment.model)
			? []
			: [{ value: experiment.model, label: catalogModelLabel(catalog, experiment.model) }]),
	]);
	const dirty = $derived(draft.trim() !== experiment.instructions);
	const locked = $derived(busy || experiment.running);
	const runLabel = $derived(
		complete && !dirty ? 'Run again' : `Run on ${sampleSize} ${sampleSize === 1 ? 'run' : 'runs'}`,
	);

	function startingDraft(): string {
		return experiment.instructions;
	}
</script>

{#if experiment.current}
	<div class="flex flex-col gap-3 p-4">
		<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
			<span class="text-fg-secondary">Model</span>
			<span class="text-fg-default">{catalogModelLabel(catalog, experiment.model)}</span>
			<span class="text-fg-tertiary ml-auto">
				This is what runs now. Start an experiment to change it.
			</span>
		</div>
		<p
			class="bg-surface-root border-border-default text-fg-secondary max-h-56 overflow-y-auto rounded-lg border-[0.5px] px-3 py-2 font-mono text-xs leading-5 whitespace-pre-wrap"
			aria-label="Instructions"
		>
			{experiment.instructions}
		</p>
	</div>
{:else}
	<div class="flex flex-col gap-3 p-4">
		<div class="w-56">
			<Select
				value={experiment.model}
				label="Model"
				options={modelOptions}
				disabled={locked}
				onchange={(model) => changeJobExperimentCommand(experiment, { model, instructions: draft })}
			/>
		</div>
		<Textarea
			bind:value={draft}
			label="Instructions"
			rows={8}
			maxlength={JOB_INSTRUCTIONS_MAX_LENGTH}
			autoGrow
			disabled={experiment.running}
		/>
		<div class="flex items-center gap-2">
			<Button
				variant={complete && !dirty ? 'secondary' : 'primary'}
				size="sm"
				loading={busy}
				disabled={experiment.running || sampleSize === 0 || draft.trim().length === 0}
				onclick={() => runJobExperimentCommand(experiment, draft)}
			>
				{#snippet leading()}
					<Icon name="play" size={12} />
				{/snippet}
				{experiment.running ? `Running on ${sampleSize} runs…` : runLabel}
			</Button>
			{#if dirty && !experiment.running}
				<Button variant="ghost" size="sm" onclick={() => (draft = experiment.instructions)}>
					Discard
				</Button>
				<span class="text-fg-tertiary text-xs">Running saves your edits.</span>
			{/if}
		</div>
	</div>
{/if}
