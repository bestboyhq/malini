<script lang="ts">
	import { Icon } from '$hyper-ui/icons';
	import { Badge } from '$hyper-ui/components/badge';
	import { Button } from '$hyper-ui/components/button';
	import { deleteRoutineCommand } from '$lib/routines/application/commands/delete-routine.command';
	import { demoteRoutineCommand } from '$lib/routines/application/commands/demote-routine.command';
	import { promoteRoutineCommand } from '$lib/routines/application/commands/promote-routine.command';
	import { automationFailuresQuery } from '$lib/routines/application/queries/automation-failures.query.svelte';
	import { pendingGatedRunsQuery } from '$lib/routines/application/queries/pending-gated-runs.query.svelte';
	import { routineActionStateQuery } from '$lib/routines/application/queries/routine-action-state.query.svelte';
	import type { Routine } from '$lib/routines/domain/routine';
	import { routineRunTarget } from '$lib/routines/domain/routine';
	import RoutineGatedRunRow from './RoutineGatedRunRow.svelte';

	interface Props {
		routine: Routine;
	}

	let { routine }: Props = $props();

	let evidenceOpen = $state(false);
	let confirmingDelete = $state(false);

	const actionState = $derived(routineActionStateQuery.data(routine.id));
	const failure = $derived(automationFailuresQuery.data(routine.id));
	const gatedRuns = $derived(pendingGatedRunsQuery.data(routine.id));

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
			<p class="text-fg-tertiary mt-0.5 truncate text-xs">
				{routine.when}
				<span class="text-fg-tertiary/70">· runs</span>
				<span class="font-mono">{routineRunTarget(routine.run)}</span>
			</p>
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
	{#if gatedRuns.length > 0}
		<ul class="border-surface-100-border mt-2 space-y-1.5 border-t pt-2">
			{#each gatedRuns as gatedRun (gatedRun.id)}
				<RoutineGatedRunRow {gatedRun} />
			{/each}
		</ul>
	{/if}
</li>
