<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { Well } from '$hyper-ui/components/well';
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

{#if load.state === 'error'}
	<div
		class="border-error-content/20 bg-error rounded-xl border-[0.5px] px-4 py-3"
		role="alert"
		data-testid="routines-load-error"
	>
		<p class="text-error-content text-xs">{load.error}</p>
		<div class="mt-2">
			<Button
				variant="secondary"
				size="sm"
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
	<Well title="Suggested" note={`${suggestions.length}`}>
		<p class="text-fg-tertiary px-3 pb-1 text-xs">
			Prompts you keep repeating. Accepting one saves the prompt as a job and starts a draft routine
			that runs it.
		</p>
		<ul class="flex flex-col gap-1.5">
			{#each suggestions as suggestion (suggestion.id)}
				<RoutineSuggestionCard {suggestion} />
			{/each}
		</ul>
	</Well>
{/if}

{#each groups as group (group.status)}
	{@const routines = routinesWithStatus(group.status)}
	<Well title={group.heading} note={routines.length > 0 ? `${routines.length}` : undefined}>
		<p class="text-fg-tertiary px-3 pb-1 text-xs">{group.description}</p>
		{#if routines.length === 0}
			<p
				class="border-surface-50-border bg-surface-50 text-fg-tertiary rounded-xl border-[0.5px] px-4 py-3 text-xs"
				data-testid={`routines-${group.status}-empty`}
			>
				{load.state === 'ready' ? group.empty : ''}
			</p>
		{:else}
			<ul class="flex flex-col gap-1.5">
				{#each routines as routine (routine.id)}
					<RoutineRow {routine} />
				{/each}
			</ul>
		{/if}
	</Well>
{/each}

<div {@attach revealSeededForm}>
	<Well title="New routine">
		<p class="text-fg-tertiary px-3 pb-1 text-xs">
			Name it, pick its trigger, and list its steps. It stays a draft until you promote it.
		</p>
		<div class="border-surface-50-border bg-surface-50 rounded-xl border-[0.5px] p-4">
			{#key draftFormKey}
				<RoutineForm seed={formSeed} />
			{/key}
		</div>
	</Well>
</div>
