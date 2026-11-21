<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { Button } from '$hyper-ui/components/button';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { createInitiativeCommand } from '$lib/initiatives/application/commands/create-initiative.command';
	import { loadInitiativesCommand } from '$lib/initiatives/application/commands/load-initiatives.command';
	import { updateInitiativeCommand } from '$lib/initiatives/application/commands/update-initiative.command';
	import { initiativesQuery } from '$lib/initiatives/application/queries/initiatives.query.svelte';
	import {
		addDays,
		initiativeFinished,
		initiativesOn,
		localDay,
		rail,
		type Initiative,
		type InitiativeDependency,
		type StandingOf,
	} from '$lib/initiatives/domain/initiative';
	import StateBlock from '$shared/errors/StateBlock.svelte';
	import { describeFailure } from '$shared/errors/failure-copy';
	import type { Repository } from '$shared/repositories/repositories.api';
	import InitiativeItem from './InitiativeItem.svelte';
	import QuietField from './QuietField.svelte';
	import RailDay from './RailDay.svelte';
	import { dayName } from './rail-labels';

	interface Props {
		repository: Repository;
		standingOf: StandingOf;
		selected: string | null;
		onselect: (id: string) => void;
		onstart: (initiative: Initiative, dependency: InitiativeDependency) => void;
	}

	let { repository, standingOf, selected, onselect, onstart }: Props = $props();

	type FocusRequest = Readonly<{ id: string; dueOn: string | null; target: 'row' | 'field' }>;

	const SECTION_LABEL =
		'text-3xs text-fg-quaternary border-surface-50-border mt-3.5 border-t-[0.5px] pt-4 pb-2 font-medium tracking-wider uppercase first:mt-0 first:border-t-0 first:pt-0';

	const initiatives = $derived(initiativesQuery.inRepository(repository.fullName));
	const loaded = $derived(initiativesQuery.loaded);
	const error = $derived(initiativesQuery.error);

	let today: string = $state(localDay(new Date()));
	let focus: FocusRequest | null = $state(null);
	let dragged: string | null = $state(null);
	const folded = new SvelteSet<string>();

	const plan = $derived(rail(today, initiatives, standingOf));
	const failure = $derived(
		error === null ? null : describeFailure(error, { subject: 'Initiatives' }),
	);
	const linkedDots = $derived(
		loaded
			? initiatives
					.flatMap(({ dependencies }) => dependencies)
					.flatMap(({ workstreams }) => workstreams)
					.map(({ workstreamId }) => standingOf(workstreamId)?.dot ?? 'gone')
					.join(' ')
			: null,
	);

	let seenDots: string | null = null;

	onMount(() => loadInitiativesCommand());

	$effect(() => {
		if (linkedDots === null) return;
		if (seenDots !== null && seenDots !== linkedDots) loadInitiativesCommand();
		seenDots = linkedDots;
	});

	function refreshToday(): void {
		today = localDay(new Date());
	}

	function toggle(id: string): void {
		if (folded.has(id)) folded.delete(id);
		else folded.add(id);
	}

	function move(initiative: Initiative, days: -1 | 1): void {
		const dueOn = initiative.dueOn === null ? today : addDays(initiative.dueOn, days);
		focus = { id: initiative.id, dueOn, target: 'row' };
		updateInitiativeCommand(initiative.id, { dueOn });
	}

	function dropOn(dueOn: string | null): void {
		const id = dragged;
		dragged = null;
		if (id === null) return;
		if (initiatives.find((initiative) => initiative.id === id)?.dueOn === dueOn) return;
		updateInitiativeCommand(id, { dueOn });
	}

	async function name(dueOn: string | null, title: string): Promise<boolean> {
		const id = await createInitiativeCommand(repository.fullName, title, dueOn);
		if (id === null) return false;
		focus = { id, dueOn, target: 'field' };
		return true;
	}

	function focusOf(initiative: Initiative): FocusRequest['target'] | null {
		if (focus?.id !== initiative.id || focus.dueOn !== initiative.dueOn) return null;
		return focus.target;
	}
</script>

<svelte:window onfocus={refreshToday} />
<svelte:document onvisibilitychange={refreshToday} />

{#snippet item(initiative: Initiative)}
	<InitiativeItem
		{initiative}
		{standingOf}
		open={!folded.has(initiative.id)}
		{selected}
		{onselect}
		focus={focusOf(initiative)}
		ontoggle={() => toggle(initiative.id)}
		onmove={(days) => move(initiative, days)}
		ondragstart={() => (dragged = initiative.id)}
		ondragend={() => (dragged = null)}
		onfocused={() => (focus = null)}
		onstart={(dependency) => onstart(initiative, dependency)}
	/>
{/snippet}

<section aria-label="Initiatives" class="pb-20">
	{#if failure}
		<StateBlock
			live="alert"
			tone={failure.tone}
			heading="Could not open initiatives"
			detail={failure.detail}
			remedy={failure.remedy}
			technical={failure.technical}
		>
			{#snippet icon()}
				<Icon name="alert" size={18} />
			{/snippet}
			{#snippet action()}
				<Button
					variant="secondary"
					size="sm"
					ariaLabel="Retry opening initiatives"
					onclick={loadInitiativesCommand}
				>
					<Icon name="refresh" size={13} />
					Retry
				</Button>
			{/snippet}
		</StateBlock>
	{:else if !loaded}
		<StateBlock heading="Loading initiatives">
			{#snippet icon()}
				<BusyIcon size={18} />
			{/snippet}
		</StateBlock>
	{:else}
		{#if plan.earlier.length > 0}
			<h2 class={SECTION_LABEL}>Earlier</h2>
			{#each plan.earlier as day (day)}
				<RailDay {day} {today} dragging={dragged !== null} ondrop={null}>
					{#each initiativesOn(initiatives, day) as initiative (initiative.id)}
						{#if !initiativeFinished(initiative, standingOf)}
							{@render item(initiative)}
						{/if}
					{/each}
				</RailDay>
			{/each}
		{/if}
		{#each plan.weeks as week, index (week.days[0])}
			{@const label = week.label ?? (index === 0 && plan.earlier.length > 0 ? 'This week' : null)}
			{#if label}
				<h2 class={SECTION_LABEL}>{label}</h2>
			{/if}
			{#each week.days as day (day)}
				<RailDay {day} {today} dragging={dragged !== null} ondrop={() => dropOn(day)}>
					{#each initiativesOn(initiatives, day) as initiative (initiative.id)}
						{@render item(initiative)}
					{:else}
						<QuietField
							label={`Name an outcome on ${dayName(day)}`}
							placeholder="Name an outcome"
							shown={initiatives.length === 0 && day === today}
							class="text-base"
							onsubmit={(title) => name(day, title)}
						/>
					{/each}
				</RailDay>
			{/each}
		{/each}
		<h2 class={SECTION_LABEL}>No date</h2>
		<RailDay day={null} {today} dragging={dragged !== null} ondrop={() => dropOn(null)}>
			{#each initiativesOn(initiatives, null) as initiative (initiative.id)}
				{@render item(initiative)}
			{/each}
			<QuietField
				label="Name an outcome with no date"
				placeholder="Name an outcome"
				shown={false}
				class="text-base"
				onsubmit={(title) => name(null, title)}
			/>
		</RailDay>
	{/if}
</section>
