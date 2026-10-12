<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { loadRoutinesCommand } from '$lib/routines/application/commands/load-routines.command';
	import { watchRoutinesHook } from '$lib/routines/application/hooks/watch-routines.hook';
	import { routineFormSeedQuery } from '$lib/routines/application/queries/routine-form-seed.query.svelte';
	import { routineSuggestionsQuery } from '$lib/routines/application/queries/routine-suggestions.query.svelte';
	import { routinesByStatusQuery } from '$lib/routines/application/queries/routines-by-status.query.svelte';
	import { routinesLoadQuery } from '$lib/routines/application/queries/routines-load.query.svelte';
	import { routineActionStateQuery } from '$lib/routines/application/queries/routine-action-state.query.svelte';
	import type { RoutineStatus } from '$lib/routines/domain/routine';
	import { ROUTINE_DRAFT_ACTION_ID } from '$lib/routines/domain/routine-action';
	import { loadRepositoriesScopeCommand } from '$shared/repositories/repositories.api';
	import RoutineForm from './RoutineForm.svelte';
	import RoutineRow from './RoutineRow.svelte';
	import RoutineSuggestionCard from './RoutineSuggestionCard.svelte';

	const load = $derived(routinesLoadQuery.data);
	const suggestions = $derived(routineSuggestionsQuery.data);
	const routinesWithStatus = $derived(routinesByStatusQuery.data);
	const formSeed = $derived(routineFormSeedQuery.data);
	const draftState = $derived(routineActionStateQuery.data(ROUTINE_DRAFT_ACTION_ID));
	const draftFormKey = $derived(`${formSeed?.suggestionId ?? 'blank'}:${draftState.completed}`);

	onMount(() => {
		loadRoutinesCommand();
		void loadRepositoriesScopeCommand();
		return watchRoutinesHook();
	});

	function revealSeededForm(node: HTMLElement): void {
		if (formSeed) node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	}

	type Group = Readonly<{
		status: RoutineStatus;
		heading: string;
		description: string;
		empty: string;
	}>;

	const groups: readonly Group[] = [
		{
			status: 'draft',
			heading: 'Drafts',
			description: 'Never triggered. Run one by hand to try it, then promote it.',
			empty: 'No drafts. Author one below, or accept a suggestion.',
		},
		{
			status: 'candidate',
			heading: 'Candidates',
			description: 'When the trigger fires, the run waits for your confirmation.',
			empty: 'No candidates.',
		},
		{
			status: 'routine',
			heading: 'Routines',
			description: 'Trusted; these run unattended when their trigger fires.',
			empty: 'No routines yet.',
		},
	];
</script>

<section class="space-y-8" aria-labelledby="routines-heading" data-testid="routines-section">
	<header>
		<h2 id="routines-heading" class="text-fg-default text-base font-semibold tracking-tight">
			Routines
		</h2>
		<p class="text-fg-tertiary mt-1 text-xs">
			A routine runs its steps in order when its trigger fires, or when you run it. It starts as a
			draft, earns a promotion to candidate where every triggered run asks first, and becomes a
			routine that runs unattended.
		</p>
	</header>

	{#if load.state === 'error'}
		<div
			class="border-error-content/20 bg-error rounded-lg border px-3 py-2.5"
			role="alert"
			data-testid="routines-load-error"
		>
			<p class="text-error-content text-xs">{load.error}</p>
			<div class="mt-2">
				<Button
					variant="secondary"
					size="2xs"
					ariaLabel="Retry loading routines"
					data-testid="routines-load-retry"
					onclick={() => loadRoutinesCommand()}
				>
					Retry
				</Button>
			</div>
		</div>
	{/if}

	{#if suggestions.length > 0}
		<section class="space-y-3" aria-labelledby="routines-suggested-heading">
			<div>
				<h3 id="routines-suggested-heading" class="text-fg-default text-sm font-medium">
					Suggested
				</h3>
				<p class="text-fg-tertiary mt-0.5 text-xs">
					Prompts you keep repeating. Accepting one saves the prompt as a job and starts a draft
					routine that runs it.
				</p>
			</div>
			<ul class="space-y-2">
				{#each suggestions as suggestion (suggestion.id)}
					<RoutineSuggestionCard {suggestion} />
				{/each}
			</ul>
		</section>
	{/if}

	{#each groups as group (group.status)}
		{@const routines = routinesWithStatus(group.status)}
		<section class="space-y-3" aria-labelledby={`routines-${group.status}-heading`}>
			<div>
				<h3 id={`routines-${group.status}-heading`} class="text-fg-default text-sm font-medium">
					{group.heading}
					{#if routines.length > 0}
						<span class="text-fg-tertiary font-normal">({routines.length})</span>
					{/if}
				</h3>
				<p class="text-fg-tertiary mt-0.5 text-xs">{group.description}</p>
			</div>
			{#if routines.length === 0}
				<p class="text-fg-tertiary text-xs" data-testid={`routines-${group.status}-empty`}>
					{load.state === 'ready' ? group.empty : ''}
				</p>
			{:else}
				<ul class="space-y-2">
					{#each routines as routine (routine.id)}
						<RoutineRow {routine} />
					{/each}
				</ul>
			{/if}
		</section>
	{/each}

	<section
		class="space-y-3"
		aria-labelledby="routines-new-draft-heading"
		{@attach revealSeededForm}
	>
		<div>
			<h3 id="routines-new-draft-heading" class="text-fg-default text-sm font-medium">
				New routine
			</h3>
			<p class="text-fg-tertiary mt-0.5 text-xs">
				Name it, pick its trigger, and list its steps. It stays a draft until you promote it.
			</p>
		</div>
		{#key draftFormKey}
			<RoutineForm seed={formSeed} />
		{/key}
	</section>
</section>
