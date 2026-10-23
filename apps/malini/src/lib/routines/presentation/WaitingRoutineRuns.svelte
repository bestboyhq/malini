<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { Icon } from '$hyper-ui/icons';
	import { confirmGatedRunCommand } from '$lib/routines/application/commands/confirm-gated-run.command';
	import { rejectGatedRunCommand } from '$lib/routines/application/commands/reject-gated-run.command';
	import { allPendingGatedRunsQuery } from '$lib/routines/application/queries/all-pending-gated-runs.query.svelte';
	import { routineActionStateQuery } from '$lib/routines/application/queries/routine-action-state.query.svelte';
	import { routineLabelsQuery } from '$lib/routines/application/queries/routine-labels.query.svelte';
	import { workstreamNameQuery } from '$shared/repositories/repositories.api';
	import { formatRoutineTimestamp } from './routine-copy';

	const gatedRuns = $derived(allPendingGatedRunsQuery.data);
	const labelOf = $derived(routineLabelsQuery.data);
	const actionStateOf = $derived(routineActionStateQuery.data);
	const workstreamNameOf = $derived(workstreamNameQuery.data);
</script>

{#each gatedRuns as gatedRun (gatedRun.id)}
	{@const label = labelOf(gatedRun.routineId) ?? 'A routine'}
	{@const actionState = actionStateOf(gatedRun.id)}
	{@const workstreamName = workstreamNameOf(gatedRun.workstreamId)}
	<div
		class="flex items-center gap-3 px-4 py-3"
		role="group"
		aria-label={`${label} wants to run`}
		data-testid="routine-waiting-run"
	>
		<span
			class="bg-warning text-warning-content grid size-7 shrink-0 place-items-center rounded-md"
			aria-hidden="true"
		>
			<Icon name="signal" size={14} />
		</span>
		<div class="min-w-0 flex-1">
			<h3 class="text-fg-default truncate text-sm font-medium">{label} wants to run</h3>
			<p class="text-fg-tertiary truncate text-xs">
				<span class="font-mono">{gatedRun.event}</span>
				{#if workstreamName}in {workstreamName}{/if}
				· {formatRoutineTimestamp(gatedRun.createdAt)}
			</p>
			{#if actionState.error}
				<p class="text-error-content text-xs" role="alert">{actionState.error}</p>
			{/if}
		</div>
		<Button
			variant="ghost"
			size="sm"
			disabled={actionState.busy}
			onclick={() => rejectGatedRunCommand(gatedRun.id)}
		>
			Skip
		</Button>
		<Button
			variant="primary"
			size="sm"
			loading={actionState.busy}
			onclick={() => confirmGatedRunCommand(gatedRun.id)}
		>
			Run it
		</Button>
	</div>
{/each}
