<script lang="ts">
	import type { ReconcilerDecisionRecord } from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Icon } from '$hyper-ui/icons';
	import { activityTime } from '../job-run-time';
	import ActivityKind from './ActivityKind.svelte';
	import { DECIDERS, DECISION_STATUS, decisionAction, decisionEvent } from './decision-copy';

	interface Props {
		decision: ReconcilerDecisionRecord;
		nowMs: number;
	}

	let { decision, nowMs }: Props = $props();

	let open = $state(false);

	const detailsId = $props.id();
	const look = $derived(DECISION_STATUS[decision.status]);
	const action = $derived(decisionAction(decision));
	const event = $derived(decisionEvent(decision));
	const time = $derived(
		activityTime(
			{
				status: decision.status === 'pending' ? 'running' : decision.status,
				startedAt: decision.createdAt,
				finishedAt: decision.finishedAt,
			},
			nowMs,
		),
	);
</script>

<div
	class="group hover:bg-surface-50-hover flex items-center gap-2 rounded-xl pr-1"
	data-testid="decision-row"
	data-decision-id={decision.id}
>
	<Button
		bare
		ariaExpanded={open}
		ariaControls={detailsId}
		ariaLabel={`${open ? 'Hide' : 'Show'} why Malini decided: ${action}, ${look.label}`}
		class="focus-visible:ring-border-default/50 flex h-7 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-xl pl-2 text-left text-xs outline-none focus-visible:ring-2"
		onclick={() => (open = !open)}
	>
		<span class={['grid size-4 shrink-0 place-items-center', look.tone]} aria-hidden="true">
			<Icon name={look.icon} size={13} />
		</span>
		<ActivityKind label="Event" />
		<span class="min-w-0 flex-1 truncate">
			<span class="text-fg-default font-medium"><SensitiveText text={action} /></span>
			<span class="text-fg-tertiary">· <SensitiveText text={event} /></span>
		</span>
		<Icon
			name="chevron-down"
			size={12}
			class={[
				'text-fg-tertiary shrink-0 transition-transform duration-150 motion-reduce:transition-none',
				open && 'rotate-180',
			]}
		/>
	</Button>
	<span class="text-fg-tertiary text-2xs shrink-0 pr-1 tabular-nums">{time}</span>
</div>
{#if open}
	<div id={detailsId} class="flex flex-col gap-2 pt-1 pr-3 pb-2.5 pl-18 text-xs">
		<ul aria-label="What Malini saw" class="text-fg-tertiary flex flex-col gap-0.5">
			{#each decision.facts.slice(1) as fact, index (index)}
				<li><SensitiveText text={fact} /></li>
			{/each}
		</ul>
		<ol aria-label="What Malini could do" class="flex flex-col gap-0.5">
			{#each decision.candidates as candidate, index (index)}
				{@const chosen = index === decision.chosen}
				<li
					class={['flex items-center gap-1.5', chosen ? 'text-fg-default' : 'text-fg-tertiary']}
					{...chosen ? { 'aria-current': 'true' as const } : {}}
				>
					<Icon
						name={chosen ? 'check' : 'circle'}
						size={11}
						class={chosen ? 'text-success-content' : 'text-fg-tertiary'}
					/>
					<span class="min-w-0 truncate"><SensitiveText text={candidate.label} /></span>
					{#if chosen}
						<span class="text-fg-tertiary shrink-0">· {DECIDERS[decision.decidedBy]}</span>
					{/if}
				</li>
			{/each}
		</ol>
		{#if decision.detail}
			<p class="text-fg-secondary"><SensitiveText text={decision.detail} /></p>
		{/if}
	</div>
{/if}
