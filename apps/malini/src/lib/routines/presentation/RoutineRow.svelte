<script lang="ts">
	import { Icon } from '$hyper-ui/icons';
	import { Badge } from '$hyper-ui/components/badge';
	import { Button } from '$hyper-ui/components/button';
	import { Select } from '$hyper-ui/components/select';
	import { deleteRoutineCommand } from '$lib/routines/application/commands/delete-routine.command';
	import { demoteRoutineCommand } from '$lib/routines/application/commands/demote-routine.command';
	import { promoteRoutineCommand } from '$lib/routines/application/commands/promote-routine.command';
	import { runRoutineNowCommand } from '$lib/routines/application/commands/run-routine-now.command';
	import { activeAutomationWorkstreamQuery } from '$lib/routines/application/queries/active-automation-workstream.query.svelte';
	import { automationFailuresQuery } from '$lib/routines/application/queries/automation-failures.query.svelte';
	import { pendingGatedRunsQuery } from '$lib/routines/application/queries/pending-gated-runs.query.svelte';
	import { routineActionStateQuery } from '$lib/routines/application/queries/routine-action-state.query.svelte';
	import { routineJobsQuery } from '$lib/routines/application/queries/routine-jobs.query.svelte';
	import type { Routine } from '$lib/routines/domain/routine';
	import { routineStepKind, routineStepTarget } from '$lib/routines/domain/routine';
	import { routineRunActionId, routineUpdateActionId } from '$lib/routines/domain/routine-action';
	import {
		activeWorkstreamsQuery,
		displayWorkstreamName,
		workstreamNameQuery,
	} from '$shared/repositories/repositories.api';
	import { ROUTINE_STEP_KIND_LABELS } from './routine-copy';
	import RoutineForm from './RoutineForm.svelte';
	import RoutineGatedRunRow from './RoutineGatedRunRow.svelte';

	interface Props {
		routine: Routine;
	}

	let { routine }: Props = $props();

	let evidenceOpen = $state(false);
	let confirmingDelete = $state(false);
	let editingFrom: number | null = $state(null);
	let chosenWorkstreamId: string | null = $state(null);

	const actionState = $derived(routineActionStateQuery.data(routine.id));
	const runState = $derived(routineActionStateQuery.data(routineRunActionId(routine.id)));
	const updateState = $derived(routineActionStateQuery.data(routineUpdateActionId(routine.id)));
	const editing = $derived(editingFrom !== null && editingFrom === updateState.completed);
	const failure = $derived(automationFailuresQuery.data(routine.id));
	const gatedRuns = $derived(pendingGatedRunsQuery.data(routine.id));
	const jobs = $derived(routineJobsQuery.data);
	const workstreams = $derived(activeWorkstreamsQuery.data);
	const activeWorkstreamId = $derived(activeAutomationWorkstreamQuery.data);

	const stepLines = $derived(
		routine.steps.map((step) => ({
			kind: ROUTINE_STEP_KIND_LABELS[routineStepKind(step)],
			target:
				'job' in step
					? (jobs.find(({ id }) => id === step.job)?.name ?? 'Missing job')
					: routineStepTarget(step),
			code: !('job' in step),
		})),
	);
	const workstreamOptions = $derived(
		workstreams.map((workstream) => ({
			value: workstream.id,
			label: workstreamNameQuery.data(workstream.id) ?? displayWorkstreamName(workstream),
		})),
	);
	const runWorkstreamId = $derived(
		[chosenWorkstreamId, activeWorkstreamId].find(
			(id) => id !== null && workstreams.some((workstream) => workstream.id === id),
		) ??
			workstreams[0]?.id ??
			null,
	);

	const promoteLabel = $derived(
		routine.status === 'draft'
			? 'Promote to candidate'
			: routine.status === 'candidate'
				? 'Promote to routine'
				: null,
	);
	const demoteLabel = $derived(
		routine.status === 'routine'
			? 'Demote to candidate'
			: routine.status === 'candidate'
				? 'Demote to draft'
				: null,
	);

	function onDelete(): void {
		deleteRoutineCommand(routine.id);
		confirmingDelete = false;
	}

	function onRunNow(): void {
		if (runWorkstreamId === null) return;
		runRoutineNowCommand(routine, runWorkstreamId);
	}
</script>

<li
	class="border-surface-50-border bg-surface-50 rounded-2xl border-[0.5px] px-4 py-3.5"
	data-testid="routine-row"
	data-routine-id={routine.id}
	data-routine-status={routine.status}
>
	<div class="flex items-start gap-3">
		<div class="min-w-0 flex-1">
			<div class="flex min-w-0 items-center gap-2">
				<span class="text-fg-default truncate text-sm font-medium">{routine.label}</span>
				<Badge>{routine.status}</Badge>
				{#if routine.origin === 'suggested'}
					<Badge>from suggestion</Badge>
				{/if}
			</div>
			<p class="text-fg-tertiary mt-0.5 truncate text-xs">{routine.when}</p>
			<ol class="mt-1.5 space-y-0.5" aria-label={`Steps of ${routine.label}`}>
				{#each stepLines as line, index (index)}
					<li class="text-fg-secondary truncate text-xs" data-testid="routine-row-step">
						<span class="text-fg-tertiary tabular-nums">{index + 1}.</span>
						{line.kind}
						<span class="text-fg-tertiary">·</span>
						<span class={[line.code && 'font-mono']}>{line.target}</span>
					</li>
				{/each}
			</ol>
			{#if failure}
				<p class="text-error-content mt-1 text-xs" data-testid="routine-compile-failure">
					{failure}
				</p>
			{/if}
			{#if routine.evidence.length > 0}
				<Button
					bare
					ariaLabel={`${evidenceOpen ? 'Hide' : 'Show'} evidence for ${routine.label}`}
					ariaExpanded={evidenceOpen}
					class="text-fg-tertiary hover:text-fg-secondary mt-1 flex cursor-pointer items-center gap-1 text-xs"
					data-testid="routine-evidence-toggle"
					onclick={() => (evidenceOpen = !evidenceOpen)}
				>
					<Icon
						name="chevron-down"
						class={`transition-transform duration-100 ${evidenceOpen ? '' : '-rotate-90'}`}
						size={12}
					/>
					Evidence ({routine.evidence.length})
				</Button>
				{#if evidenceOpen}
					<ul class="mt-1 space-y-1 pl-4" data-testid="routine-evidence">
						{#each routine.evidence as evidence, index (index)}
							<li class="text-fg-tertiary text-xs">
								{#if evidence.kind === 'prompt'}
									<span class="text-fg-secondary">"{evidence.text}"</span>
								{:else}
									<span class="text-fg-secondary">Run {evidence.runId}</span>
									{#if evidence.summary}
										<span>- {evidence.summary}</span>
									{/if}
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			{/if}
		</div>
		<div class="flex shrink-0 items-center gap-1.5">
			{#if confirmingDelete}
				<span class="text-fg-secondary text-xs">Delete this {routine.status}?</span>
				<Button
					variant="danger"
					size="2xs"
					ariaLabel={`Confirm deleting ${routine.label}`}
					loading={actionState.busy}
					data-testid="routine-delete-confirm"
					onclick={onDelete}
				>
					Delete
				</Button>
				<Button
					variant="ghost"
					size="2xs"
					ariaLabel="Keep this routine"
					disabled={actionState.busy}
					data-testid="routine-delete-cancel"
					onclick={() => (confirmingDelete = false)}
				>
					Cancel
				</Button>
			{:else}
				<Button
					variant="ghost"
					size="2xs"
					ariaLabel={`Edit ${routine.label}`}
					ariaExpanded={editing}
					disabled={actionState.busy}
					data-testid="routine-edit"
					onclick={() => (editingFrom = editing ? null : updateState.completed)}
				>
					Edit
				</Button>
				{#if promoteLabel}
					<Button
						variant="secondary"
						size="2xs"
						ariaLabel={`${promoteLabel}: ${routine.label}`}
						loading={actionState.busy}
						data-testid="routine-promote"
						onclick={() => promoteRoutineCommand(routine.id)}
					>
						{promoteLabel}
					</Button>
				{/if}
				{#if demoteLabel}
					<Button
						variant="ghost"
						size="2xs"
						ariaLabel={`${demoteLabel}: ${routine.label}`}
						disabled={actionState.busy}
						data-testid="routine-demote"
						onclick={() => demoteRoutineCommand(routine.id)}
					>
						{demoteLabel}
					</Button>
				{/if}
				<Button
					variant="ghost"
					size="2xs"
					ariaLabel={`Delete ${routine.label}`}
					disabled={actionState.busy}
					data-testid="routine-delete"
					onclick={() => (confirmingDelete = true)}
				>
					Delete
				</Button>
			{/if}
		</div>
	</div>
	{#if actionState.error}
		<p class="text-error-content mt-1.5 text-xs" role="alert" data-testid="routine-action-error">
			{actionState.error}
		</p>
	{/if}
	{#if editing}
		<div class="border-surface-100-border mt-3 border-t pt-3">
			<RoutineForm {routine} oncancel={() => (editingFrom = null)} />
		</div>
	{:else}
		<div class="mt-3 flex items-center gap-2" data-testid="routine-run-now">
			<Select
				value={runWorkstreamId ?? ''}
				options={workstreamOptions.length > 0
					? workstreamOptions
					: [{ value: '', label: 'No workstreams yet', disabled: true }]}
				ariaLabel={`Workstream to run ${routine.label} in`}
				disabled={workstreamOptions.length === 0 || runState.busy}
				class="w-56 min-w-0"
				onchange={(value) => (chosenWorkstreamId = value)}
				data-testid="routine-run-workstream"
			/>
			<Button
				variant="secondary"
				size="sm"
				ariaLabel={`Run ${routine.label} now`}
				loading={runState.busy}
				disabled={runWorkstreamId === null}
				data-testid="routine-run"
				onclick={onRunNow}
			>
				{#snippet leading()}
					<Icon name="play" size={12} />
				{/snippet}
				Run now
			</Button>
		</div>
		{#if runState.error}
			<p class="text-error-content mt-1.5 text-xs" role="alert" data-testid="routine-run-error">
				{runState.error}
			</p>
		{/if}
	{/if}
	{#if gatedRuns.length > 0}
		<ul class="border-surface-100-border mt-2 space-y-1.5 border-t pt-2">
			{#each gatedRuns as gatedRun (gatedRun.id)}
				<RoutineGatedRunRow {gatedRun} />
			{/each}
		</ul>
	{/if}
</li>
