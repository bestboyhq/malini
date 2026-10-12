<script lang="ts">
	import { Icon } from '$hyper-ui/icons';
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Select, type SelectItem } from '$hyper-ui/components/select';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Textarea } from '$hyper-ui/components/textarea';
	import { ROUTINE_MAX_STEPS, type RoutineStepKind } from '$lib/routines/domain/routine';
	import type { RoutineJob } from '$lib/routines/domain/routine-job';
	import {
		emptyRoutineStepDraft,
		moveRoutineStep,
		type RoutineStepDraft,
	} from '$lib/routines/domain/routine-step-draft';
	import type { AutomationRunOption } from '$shared/extensions/automation-rules.store.svelte';
	import { ROUTINE_STEP_KIND_LABELS } from './routine-copy';

	interface Props {
		steps: RoutineStepDraft[];
		jobs: readonly RoutineJob[];
		runOptions: readonly AutomationRunOption[] | null;
		newKey: () => string;
	}

	let { steps = $bindable(), jobs, runOptions, newKey }: Props = $props();

	const STEP_KINDS: readonly RoutineStepKind[] = ['job', 'command', 'workflow'];
	const kindOptions: SelectItem[] = STEP_KINDS.map((kind) => ({
		value: kind,
		label: ROUTINE_STEP_KIND_LABELS[kind],
	}));

	function jobOptions(selected: string): SelectItem[] {
		const missing =
			selected && !jobs.some(({ id }) => id === selected)
				? [{ value: selected, label: 'Missing job' }]
				: [];
		return [
			{ value: '', label: jobs.length > 0 ? 'Choose a job' : 'No jobs yet', disabled: true },
			...missing,
			...jobs.map((job) => ({ value: job.id, label: job.name })),
		];
	}

	function targetOptions(
		kind: 'command' | 'workflow',
		options: readonly AutomationRunOption[],
		selected: string,
	): SelectItem[] {
		const listed = options.filter((option) => option.kind === kind);
		const missing =
			selected && !listed.some(({ id }) => id === selected)
				? [{ value: selected, label: selected }]
				: [];
		return [
			{ value: '', label: `Choose a ${kind}`, disabled: true },
			...missing,
			...listed.map((option) => ({ value: option.id, label: option.label })),
		];
	}

	function onKindChange(index: number, value: string): void {
		const kind = STEP_KINDS.find((candidate) => candidate === value);
		const step = steps[index];
		if (kind && step) step.kind = kind;
	}

	function onAdd(): void {
		steps = [...steps, emptyRoutineStepDraft(newKey())];
	}

	function onMove(index: number, offset: number): void {
		steps = moveRoutineStep(steps, index, offset);
	}

	function onRemove(index: number): void {
		steps = steps.filter((_, position) => position !== index);
	}
</script>

<div class="space-y-2">
	<ol class="space-y-2" aria-label="Steps" data-testid="routine-steps">
		{#each steps as step, index (step.key)}
			{@const position = index + 1}
			<li
				class="border-surface-100-border bg-surface-100 space-y-2 rounded-xl border px-3 py-3"
				data-testid="routine-step"
			>
				<div class="flex items-center gap-2">
					<span class="text-fg-tertiary w-4 shrink-0 text-xs tabular-nums" aria-hidden="true">
						{position}
					</span>
					<Select
						value={step.kind}
						options={kindOptions}
						ariaLabel={`Kind of step ${position}`}
						class="min-w-0 flex-1"
						onchange={(value) => onKindChange(index, value)}
						data-testid="routine-step-kind"
					/>
					<IconButton
						variant="ghost"
						size="sm"
						ariaLabel={`Move step ${position} up`}
						disabled={index === 0}
						onclick={() => onMove(index, -1)}
					>
						<Icon name="arrow-up" size={13} />
					</IconButton>
					<IconButton
						variant="ghost"
						size="sm"
						ariaLabel={`Move step ${position} down`}
						disabled={index === steps.length - 1}
						onclick={() => onMove(index, 1)}
					>
						<Icon name="arrow-down" size={13} />
					</IconButton>
					<IconButton
						variant="ghost"
						size="sm"
						ariaLabel={`Remove step ${position}`}
						disabled={steps.length === 1}
						onclick={() => onRemove(index)}
					>
						<Icon name="trash" size={13} />
					</IconButton>
				</div>
				<div class="space-y-2 pl-6">
					{#if step.kind === 'job'}
						<Select
							bind:value={step.job}
							options={jobOptions(step.job)}
							ariaLabel={`Job for step ${position}`}
							{...jobs.length === 0 ? { hint: 'Create a job in the Jobs section first.' } : {}}
							data-testid="routine-step-job"
						/>
					{:else if step.kind === 'command'}
						{#if runOptions === null}
							<TextInput
								bind:value={step.command}
								ariaLabel={`Command for step ${position}`}
								placeholder="malini.repository.refresh"
								data-testid="routine-step-command"
							/>
						{:else}
							<Select
								bind:value={step.command}
								options={targetOptions('command', runOptions, step.command)}
								ariaLabel={`Command for step ${position}`}
								data-testid="routine-step-command"
							/>
						{/if}
						<Textarea
							bind:value={step.args}
							label={`Arguments for step ${position} (JSON array)`}
							rows={2}
							textareaClass="font-mono text-xs"
							data-testid="routine-step-args"
						/>
					{:else}
						{#if runOptions === null}
							<TextInput
								bind:value={step.workflow}
								ariaLabel={`Workflow for step ${position}`}
								placeholder="malini.preview.ensure-ready"
								data-testid="routine-step-workflow"
							/>
						{:else}
							<Select
								bind:value={step.workflow}
								options={targetOptions('workflow', runOptions, step.workflow)}
								ariaLabel={`Workflow for step ${position}`}
								data-testid="routine-step-workflow"
							/>
						{/if}
						<Textarea
							bind:value={step.input}
							label={`Workflow input for step ${position} (JSON object)`}
							rows={2}
							textareaClass="font-mono text-xs"
							data-testid="routine-step-input"
						/>
					{/if}
				</div>
			</li>
		{/each}
	</ol>
	<Button
		variant="ghost"
		size="2xs"
		ariaLabel="Add a step"
		disabled={steps.length >= ROUTINE_MAX_STEPS}
		onclick={onAdd}
		data-testid="routine-step-add"
	>
		{#snippet leading()}
			<Icon name="plus" size={12} />
		{/snippet}
		Add step
	</Button>
</div>
