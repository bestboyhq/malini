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
	import {
		connectedRepositoriesQuery,
		hiddenRepositoriesQuery,
		type Repository,
	} from '$shared/repositories/repositories.api';
	import InitiativeItem from './InitiativeItem.svelte';
	import QuietField from './QuietField.svelte';
	import RailDay from './RailDay.svelte';
	import { dayName } from './rail-labels';

	interface Props {
		standingOf: StandingOf;
		onstart: (
			initiative: Initiative,
			dependency: InitiativeDependency,
			repository: Repository,
		) => void;
	}

	let { standingOf, onstart }: Props = $props();

	type FocusRequest = Readonly<{ id: string; dueOn: string | null; target: 'row' | 'field' }>;

	const SECTION_LABEL =
		'text-3xs text-fg-quaternary border-border-subtle mt-3.5 border-t pt-4 pb-2 font-medium tracking-wider uppercase first:mt-0 first:border-t-0 first:pt-0';

	const initiatives = $derived(initiativesQuery.data);
	const loaded = $derived(initiativesQuery.loaded);
	const error = $derived(initiativesQuery.error);
	const repositories = $derived(
		connectedRepositoriesQuery.data.filter(
			(repository) => !hiddenRepositoriesQuery.data.has(repository.id),
		),
	);

	let today: string = $state(localDay(new Date()));
	let focus: FocusRequest | null = $state(null);
	let dragged: string | null = $state(null);
	const opened = new SvelteSet<string>();

	const plan = $derived(rail(today, initiatives, standingOf));
	const failure = $derived(
		error === null ? null : describeFailure(error, { subject: 'Initiatives' }),
	);

	onMount(() => loadInitiativesCommand());

	function refreshToday(): void {
		today = localDay(new Date());
	}

	function toggle(id: string): void {
		if (opened.has(id)) opened.delete(id);
		else opened.add(id);
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
		const id = await createInitiativeCommand(title, dueOn);
		if (id === null) return false;
		opened.add(id);
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
		{repositories}
		open={opened.has(initiative.id)}
		focus={focusOf(initiative)}
		ontoggle={() => toggle(initiative.id)}
		onmove={(days) => move(initiative, days)}
		ondragstart={() => (dragged = initiative.id)}
		ondragend={() => (dragged = null)}
		onfocused={() => (focus = null)}
		onstart={(dependency, repository) => onstart(initiative, dependency, repository)}
	/>
{/snippet}

<section aria-label="Initiatives" class="mx-auto w-full max-w-[760px] px-8 pt-7 pb-20">
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
