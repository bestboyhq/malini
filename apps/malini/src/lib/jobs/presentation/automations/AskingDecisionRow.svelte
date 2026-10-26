<script lang="ts">
	import type { ReconcilerDecisionRecord } from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Icon } from '$hyper-ui/icons';
	import { decideCommand } from '$lib/jobs/application/commands/decide.command';
	import { jobActionStateQuery } from '$lib/jobs/application/queries/job-action-state.query.svelte';
	import { activityTime } from '../job-run-time';
	import { decisionChoices, decisionEvent, decisionQuestion } from './decision-copy';

	interface Props {
		decision: ReconcilerDecisionRecord;
		nowMs: number;
	}

	let { decision, nowMs }: Props = $props();

	const actionState = $derived(jobActionStateQuery.data(decision.id));
	const question = $derived(decisionQuestion(decision));
	const event = $derived(decisionEvent(decision));
	const choices = $derived(decisionChoices(decision));
	const time = $derived(
		activityTime({ status: 'asking', startedAt: decision.createdAt, finishedAt: null }, nowMs),
	);
</script>

<div
	class="flex flex-col gap-2.5 px-4 py-3"
	role="group"
	aria-label={`Malini asks: ${question}`}
	data-testid="decision-asking"
	data-decision-id={decision.id}
>
	<div class="flex items-center gap-3">
		<span
			class="bg-warning text-warning-content grid size-7 shrink-0 place-items-center rounded-md"
			aria-hidden="true"
		>
			<Icon name="route" size={14} />
		</span>
		<div class="min-w-0 flex-1">
			<h3 class="text-fg-default text-sm font-medium"><SensitiveText text={question} /></h3>
			<p class="text-fg-tertiary truncate text-xs tabular-nums">
				<SensitiveText text={event} /> · {time}
			</p>
		</div>
	</div>
	{#if actionState.error}
		<p class="text-error-content pl-10 text-xs" role="alert">{actionState.error}</p>
	{/if}
	<div class="flex flex-wrap items-center gap-1.5 pl-10">
		{#each choices as { index, candidate } (index)}
			<Button
				variant={candidate.kind === 'nothing'
					? 'ghost'
					: index === decision.pick && decision.decidedBy === 'rules'
						? 'primary'
						: 'secondary'}
				size="sm"
				disabled={actionState.busy}
				onclick={() => decideCommand(decision, index)}
			>
				<SensitiveText text={candidate.label} />
			</Button>
		{/each}
	</div>
</div>
