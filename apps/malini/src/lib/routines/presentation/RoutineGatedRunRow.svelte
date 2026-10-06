<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { confirmGatedRunCommand } from '$lib/routines/application/commands/confirm-gated-run.command';
	import { rejectGatedRunCommand } from '$lib/routines/application/commands/reject-gated-run.command';
	import { routineActionStateQuery } from '$lib/routines/application/queries/routine-action-state.query.svelte';
	import type { RoutineGatedRun } from '$lib/routines/domain/routine-gated-run';
	import { formatRoutineTimestamp } from './routine-copy';

	interface Props {
		gatedRun: RoutineGatedRun;
	}

	let { gatedRun }: Props = $props();

	const actionState = $derived(routineActionStateQuery.data(gatedRun.id));
</script>

<li data-testid="routine-gated-run" data-gated-run-id={gatedRun.id}>
	<div class="flex items-center gap-3">
		<div class="min-w-0 flex-1">
			<p class="text-fg-secondary truncate text-xs">
				Held: <span class="font-mono">{gatedRun.event}</span>
				<span class="text-fg-tertiary">in {gatedRun.workstreamId}</span>
			</p>
			<p class="text-fg-tertiary text-xs">{formatRoutineTimestamp(gatedRun.createdAt)}</p>
		</div>
		<div class="flex shrink-0 items-center gap-1.5">
			<Button
				variant="secondary"
				size="2xs"
				ariaLabel={`Confirm this ${gatedRun.event} run`}
				loading={actionState.busy}
				data-testid="routine-gated-confirm"
				onclick={() => confirmGatedRunCommand(gatedRun.id)}
			>
				Confirm
			</Button>
			<Button
				variant="ghost"
				size="2xs"
				ariaLabel={`Reject this ${gatedRun.event} run`}
				disabled={actionState.busy}
				data-testid="routine-gated-reject"
				onclick={() => rejectGatedRunCommand(gatedRun.id)}
			>
				Reject
			</Button>
		</div>
	</div>
	{#if actionState.error}
		<p class="text-error-content mt-1 text-xs" role="alert" data-testid="routine-gated-run-error">
			{actionState.error}
		</p>
	{/if}
</li>
