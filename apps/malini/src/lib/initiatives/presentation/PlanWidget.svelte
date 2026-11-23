<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import type { WidgetSize } from '$contract/widgets';
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { createInitiativeCommand } from '$lib/initiatives/application/commands/create-initiative.command';
	import { loadInitiativesCommand } from '$lib/initiatives/application/commands/load-initiatives.command';
	import { keepPlanSyncedHook } from '$lib/initiatives/application/hooks/keep-plan-synced.hook';
	import { initiativesQuery } from '$lib/initiatives/application/queries/initiatives.query.svelte';
	import { planSyncQuery } from '$lib/initiatives/application/queries/plan-sync.query.svelte';
	import {
		dateOf,
		initiativeFinished,
		initiativeProgress,
		isWeekend,
		localDay,
		type Initiative,
		type InitiativeDependency,
		type StandingOf,
	} from '$lib/initiatives/domain/initiative';
	import {
		daysUntil,
		dueLabel,
		outcomesFor,
		planDays,
		planOrder,
	} from '$lib/initiatives/domain/plan';
	import { repositoryWebUrl, type Repository } from '$shared/repositories/repositories.api';
	import PlanOutcome from './PlanOutcome.svelte';
	import PlanSyncStatus from './PlanSyncStatus.svelte';
	import ProgressRing from './ProgressRing.svelte';
	import QuietField from './QuietField.svelte';
	import { dayName, weekdayOf } from './rail-labels';

	interface Props {
		repository: Repository;
		standingOf: StandingOf;
		size: WidgetSize;
		currentWorkstreamId: string | null;
		onstart: (initiative: Initiative, dependency: InitiativeDependency) => void;
		onopen: () => void;
	}

	let { repository, standingOf, size, currentWorkstreamId, onstart, onopen }: Props = $props();

	const initiatives = $derived(initiativesQuery.inRepository(repository.fullName));
	const loaded = $derived(initiativesQuery.loaded);
	const error = $derived(initiativesQuery.error);
	const sync = $derived(planSyncQuery.data(repository.fullName));

	let today: string = $state(localDay(new Date()));
	let adding: string | null = $state(null);
	const toggled = new SvelteSet<string>();

	const onGithub = $derived(repositoryWebUrl(repository.remoteUrl) !== null);
	const ordered = $derived(planOrder(initiatives));
	const shown = $derived(outcomesFor(size, ordered, today, standingOf));
	const next = $derived(size === 'small' ? (shown[0] ?? null) : null);
	const byDay = $derived(planDays(shown));

	onMount(() => loadInitiativesCommand());

	$effect(() => (onGithub ? keepPlanSyncedHook(repository.fullName) : undefined));

	function refreshToday(): void {
		today = localDay(new Date());
	}

	function isOpen(initiative: Initiative): boolean {
		return initiativeFinished(initiative, standingOf) === toggled.has(initiative.id);
	}

	function toggle(initiative: Initiative): void {
		if (isOpen(initiative) && adding === initiative.id) adding = null;
		if (toggled.has(initiative.id)) toggled.delete(initiative.id);
		else toggled.add(initiative.id);
	}

	async function name(title: string): Promise<boolean> {
		const id = await createInitiativeCommand(repository.fullName, title, null);
		if (id === null) return false;
		adding = id;
		return true;
	}
</script>

<svelte:window onfocus={refreshToday} />
<svelte:document onvisibilitychange={refreshToday} />

{#snippet firstOutcome()}
	<div class="flex h-full flex-col justify-end">
		<QuietField
			label="Name an outcome with no date"
			placeholder="Name an outcome"
			shown
			class="text-xs"
			inputClass="h-7"
			onsubmit={name}
		/>
	</div>
{/snippet}

{#snippet openPlan()}
	<Tooltip content="Open the plan" placement="top" class="flex shrink-0">
		<IconButton
			variant="ghost"
			size="xs"
			ariaLabel="Open the plan"
			class="text-fg-tertiary"
			onclick={onopen}
		>
			<Icon name="arrow-right" size={12} />
		</IconButton>
	</Tooltip>
{/snippet}

<div class="flex h-full min-h-0 flex-col">
	{#if error !== null}
		<div class="text-2xs text-fg-tertiary flex h-full flex-col justify-end gap-2">
			<span>Plan not loaded</span>
			<Button variant="secondary" size="xs" class="self-start" onclick={loadInitiativesCommand}>
				Retry
			</Button>
		</div>
	{:else if !loaded}
		<div class="text-fg-tertiary flex h-full items-end">
			<BusyIcon size={14} ariaLabel="Loading the plan" />
		</div>
	{:else if initiatives.length === 0 && size !== 'large'}
		{@render firstOutcome()}
	{:else if size === 'small'}
		<Button
			bare
			class="flex h-full min-w-0 flex-col items-start justify-end text-left"
			onclick={onopen}
		>
			{#if next}
				{@const progress = initiativeProgress(next, standingOf)}
				{@const days = next.dueOn === null ? null : daysUntil(next.dueOn, today)}
				{#if days !== null}
					<span class="flex items-baseline gap-1">
						<span
							class="text-fg-default text-3xl leading-none font-medium tracking-tight tabular-nums"
						>
							{Math.abs(days)}
						</span>
						<span class={['text-xs', days < 0 ? 'text-error-content' : 'text-fg-tertiary']}>
							{days < 0 ? 'd late' : 'd'}
						</span>
					</span>
				{/if}
				<span class="text-2xs text-fg-secondary mt-1.5 line-clamp-2">
					<SensitiveText text={next.title} />
				</span>
				<span class="text-3xs text-fg-tertiary mt-2 flex items-center gap-1.5">
					<ProgressRing done={progress.done} total={progress.total} size={12} />
					{progress.total > 0 ? `${progress.done} of ${progress.total}` : 'No dependencies'}
				</span>
			{:else}
				<span class="text-2xs text-fg-secondary">Every outcome is done. Agents are bored</span>
			{/if}
		</Button>
	{:else if size === 'medium'}
		<Button
			bare
			class="-mx-2 flex h-full min-w-0 flex-col justify-start text-left"
			onclick={onopen}
		>
			{#each shown as initiative (initiative.id)}
				{@const progress = initiativeProgress(initiative, standingOf)}
				{@const due = dueLabel(initiative.dueOn, today, false)}
				<span class="flex h-7 w-full items-center gap-2 px-2 text-xs">
					<ProgressRing done={progress.done} total={progress.total} size={14} />
					<span class="text-fg-default min-w-0 flex-1 truncate font-medium">
						<SensitiveText text={initiative.title} />
					</span>
					<span
						class={[
							'text-3xs shrink-0 whitespace-nowrap',
							due.late ? 'text-error-content' : 'text-fg-tertiary',
						]}
					>
						{due.text}
					</span>
				</span>
			{:else}
				<span class="text-2xs text-fg-secondary px-2">Every outcome is done. Agents are bored</span>
			{/each}
		</Button>
	{:else}
		<ScrollableDiv class="@container -mx-2 min-h-0 flex-1" fadeEdges ariaLabel="Outcomes">
			{#each byDay as { day, outcomes } (day)}
				{@const isToday = day === today}
				{@const dim = day !== null && isWeekend(day)}
				<div
					class="grid pt-1 first:pt-0 @sm:grid-cols-[68px_minmax(0,1fr)]"
					role="group"
					aria-label={day ? dayName(day) : 'No date'}
				>
					<div class="flex h-6 items-center gap-1 px-2 @sm:h-7" aria-hidden="true">
						{#if day}
							<span
								class={[
									'text-3xs @sm:w-6',
									isToday ? 'text-fg-default' : dim ? 'text-fg-quaternary' : 'text-fg-tertiary',
								]}
							>
								{weekdayOf(day)}
							</span>
							<span
								class={[
									'h-5 rounded-md text-center text-xs leading-5 font-semibold tabular-nums @sm:min-w-6',
									isToday
										? 'bg-surface-invert text-fg-invert min-w-5 px-1'
										: dim
											? 'text-fg-quaternary'
											: 'text-fg-default',
								]}
							>
								{dateOf(day).getDate()}
							</span>
						{:else}
							<span class="text-3xs text-fg-tertiary whitespace-nowrap">No date</span>
						{/if}
					</div>
					<div class="min-w-0">
						{#each outcomes as initiative (initiative.id)}
							<PlanOutcome
								{initiative}
								{standingOf}
								{today}
								{currentWorkstreamId}
								open={isOpen(initiative)}
								adding={adding === initiative.id}
								ontoggle={() => toggle(initiative)}
								onadding={(on) => (adding = on ? initiative.id : null)}
								onstart={(dependency) => onstart(initiative, dependency)}
							/>
						{/each}
					</div>
				</div>
			{/each}
			<div class="text-fg-quaternary flex h-7 items-center gap-2 px-2">
				<Icon name="plus" size={12} class="shrink-0" />
				<QuietField
					label="Name an outcome with no date"
					placeholder="Name an outcome"
					shown
					class="min-w-0 flex-1 text-xs"
					inputClass="h-7"
					onsubmit={name}
				/>
			</div>
		</ScrollableDiv>
		<footer
			class="border-surface-50-border text-3xs text-fg-tertiary flex h-[30px] shrink-0 items-center gap-2 border-t-[0.5px]"
		>
			{#if onGithub && sync?.enabled}
				<PlanSyncStatus {sync} />
				{@render openPlan()}
			{:else}
				<Button
					bare
					class="hover:text-fg-default focus-visible:ring-border-default/50 -mx-1.5 flex h-6 min-w-0 flex-1 cursor-pointer items-center justify-between rounded-md px-1.5 outline-0 transition-[color] focus-visible:ring-2"
					onclick={onopen}
				>
					Open the plan<Icon name="arrow-right" size={12} />
				</Button>
			{/if}
		</footer>
	{/if}
</div>
