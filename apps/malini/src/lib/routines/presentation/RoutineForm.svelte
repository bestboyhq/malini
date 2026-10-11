<script lang="ts">
	import { untrack } from 'svelte';
	import { Icon } from '$hyper-ui/icons';
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Select, type SelectItem } from '$hyper-ui/components/select';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { clearRoutineFormSeedCommand } from '$lib/routines/application/commands/clear-routine-form-seed.command';
	import { createRoutineDraftCommand } from '$lib/routines/application/commands/create-routine-draft.command';
	import { updateRoutineCommand } from '$lib/routines/application/commands/update-routine.command';
	import { automationRunOptionsQuery } from '$lib/routines/application/queries/automation-run-options.query.svelte';
	import { routineActionStateQuery } from '$lib/routines/application/queries/routine-action-state.query.svelte';
	import { routineJobsQuery } from '$lib/routines/application/queries/routine-jobs.query.svelte';
	import {
		ROUTINE_LABEL_MAX_LENGTH,
		type Routine,
		type RoutineRun,
	} from '$lib/routines/domain/routine';
	import {
		ROUTINE_DRAFT_ACTION_ID,
		routineUpdateActionId,
	} from '$lib/routines/domain/routine-action';
	import type { RoutineFormSeed } from '$lib/routines/domain/routine-draft';
	import {
		emptyRoutineStepDraft,
		routineRunFromStepDraft,
		routineStepDraftFromRun,
		type RoutineStepDraft,
	} from '$lib/routines/domain/routine-step-draft';
	import { ROUTINE_WHEN_PHRASES } from '$lib/routines/domain/routine-when-phrase';
	import { validateRoutineWhenPhrase } from './routine-when-phrase';
	import RoutineStepsEditor from './RoutineStepsEditor.svelte';

	interface Props {
		routine?: Routine | null;
		seed?: RoutineFormSeed | null;
		oncancel?: () => void;
	}

	let { routine = null, seed = null, oncancel }: Props = $props();

	const actionState = $derived(
		routineActionStateQuery.data(
			routine ? routineUpdateActionId(routine.id) : ROUTINE_DRAFT_ACTION_ID,
		),
	);
	const jobs = $derived(routineJobsQuery.data);
	const runOptions = $derived(automationRunOptionsQuery.data);

	let nextStepKey = 0;
	const initial = untrack(() => routine ?? seed);
	let label = $state(initial?.label ?? '');
	let when = $state<string>(initial?.when ?? ROUTINE_WHEN_PHRASES[0]);
	let steps: RoutineStepDraft[] = $state(stepDraftsFor(initial?.steps ?? []));
	let localError: string | null = $state(null);

	const whenValidation = $derived(validateRoutineWhenPhrase(when));
	const whenOptions = $derived<SelectItem[]>([
		...(ROUTINE_WHEN_PHRASES.some((phrase) => phrase === when)
			? []
			: [{ value: when, label: when }]),
		...ROUTINE_WHEN_PHRASES.map((phrase) => ({ value: phrase, label: phrase })),
	]);
	const submitError = $derived(localError ?? actionState.error);

	function newStepKey(): string {
		nextStepKey += 1;
		return `step-${nextStepKey}`;
	}

	function stepDraftsFor(runs: readonly RoutineRun[]): RoutineStepDraft[] {
		if (runs.length === 0) return [emptyRoutineStepDraft(newStepKey())];
		return runs.map((run) => routineStepDraftFromRun(run, newStepKey()));
	}

	function onSubmit(event: SubmitEvent): void {
		event.preventDefault();
		if (actionState.busy) return;
		localError = null;
		const trimmedLabel = label.trim();
		if (!trimmedLabel) {
			localError = 'Give the routine a label.';
			return;
		}
		if (!whenValidation.ok) {
			localError = whenValidation.message;
			return;
		}
		let runs: RoutineRun[];
		try {
			runs = steps.map((step, index) => routineRunFromStepDraft(step, index + 1));
		} catch (error) {
			localError = error instanceof Error ? error.message : String(error);
			return;
		}
		if (runs.length === 0) {
			localError = 'Add at least one step.';
			return;
		}
		if (routine) {
			updateRoutineCommand(routine.id, { label: trimmedLabel, when, steps: runs });
			return;
		}
		createRoutineDraftCommand({
			label: trimmedLabel,
			when,
			steps: runs,
			...(seed ? { suggestionId: seed.suggestionId, origin: 'suggested' as const } : {}),
		});
	}
</script>

<form
	class="space-y-3"
	aria-label={routine ? `Editing ${routine.label}` : 'New routine'}
	data-testid={routine ? 'routine-edit-form' : 'routine-draft-form'}
	onsubmit={onSubmit}
>
	{#if !routine && seed}
		<div
			class="border-surface-100-border bg-surface-100 flex items-center gap-2 rounded-lg border px-3 py-2"
			data-testid="routine-draft-suggestion-chip"
		>
			<p class="text-fg-secondary min-w-0 flex-1 text-xs">
				Accepting a suggestion - its prompt is now the job “{seed.label}”, and the draft keeps its
				{seed.evidenceCount}
				{seed.evidenceCount === 1 ? 'prompt' : 'prompts'} as evidence.
			</p>
			<IconButton
				variant="ghost"
				size="sm"
				ariaLabel="Stop accepting this suggestion"
				data-testid="routine-draft-suggestion-clear"
				onclick={() => clearRoutineFormSeedCommand()}
			>
				<Icon name="close" size={13} />
			</IconButton>
		</div>
	{/if}

	<TextInput
		bind:value={label}
		label="Label"
		placeholder="Fix flaky tests, then refresh the preview"
		maxlength={ROUTINE_LABEL_MAX_LENGTH}
		required
		data-testid="routine-form-label"
	/>

	<Select
		bind:value={when}
		label="When"
		options={whenOptions}
		{...whenValidation.ok ? { hint: whenValidation.description } : {}}
		invalid={!whenValidation.ok}
		data-testid="routine-form-when"
	/>
	{#if !whenValidation.ok}
		<p class="text-error-content text-xs" role="alert" data-testid="routine-form-when-error">
			{whenValidation.message}
		</p>
	{/if}

	<div class="space-y-2">
		<div>
			<p class="text-fg-secondary text-sm font-medium">Steps</p>
			<p class="text-fg-tertiary text-xs">Run in order. A step that fails stops the rest.</p>
		</div>
		<RoutineStepsEditor bind:steps {jobs} {runOptions} newKey={newStepKey} />
	</div>

	{#if submitError}
		<p class="text-error-content text-xs" role="alert" data-testid="routine-form-error">
			{submitError}
		</p>
	{/if}

	<div class="flex items-center gap-2">
		<Button
			type="submit"
			variant="secondary"
			size="sm"
			ariaLabel={routine ? `Save ${routine.label}` : 'Create the draft routine'}
			loading={actionState.busy}
			data-testid="routine-form-submit"
		>
			{routine ? 'Save' : 'Create draft'}
		</Button>
		{#if oncancel}
			<Button
				variant="ghost"
				size="sm"
				ariaLabel="Cancel editing"
				disabled={actionState.busy}
				data-testid="routine-form-cancel"
				onclick={oncancel}
			>
				Cancel
			</Button>
		{/if}
	</div>
</form>
