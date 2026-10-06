<script lang="ts">
	import { onMount } from 'svelte';
	import { Icon } from '$hyper-ui/icons';
	import { Button } from '$hyper-ui/components/button';
	import { loadRoutinesCommand } from '$lib/routines/application/commands/load-routines.command';
	import { watchRoutinesHook } from '$lib/routines/application/hooks/watch-routines.hook';
	import { routineSuggestionsQuery } from '$lib/routines/application/queries/routine-suggestions.query.svelte';
	import { routinesByStatusQuery } from '$lib/routines/application/queries/routines-by-status.query.svelte';
	import { routinesLoadQuery } from '$lib/routines/application/queries/routines-load.query.svelte';
	import type { RoutineStatus } from '$lib/routines/domain/routine';
	import type { RoutineSuggestion } from '$lib/routines/domain/routine-suggestion';
	import RoutineDraftForm from './RoutineDraftForm.svelte';
	import RoutineRow from './RoutineRow.svelte';
	import RoutineSuggestionCard from './RoutineSuggestionCard.svelte';

	const load = $derived(routinesLoadQuery.data);
	const suggestions = $derived(routineSuggestionsQuery.data);
	const routinesWithStatus = $derived(routinesByStatusQuery.data);

	let acceptingSuggestion = $state<RoutineSuggestion | null>(null);
	let draftFormElement = $state<HTMLElement | null>(null);

	onMount(() => {
		loadRoutinesCommand();
		return watchRoutinesHook();
	});

	$effect(() => {
		if (acceptingSuggestion && !suggestions.some(({ id }) => id === acceptingSuggestion?.id)) {
			acceptingSuggestion = null;
		}
	});

	function onAcceptSuggestion(suggestion: RoutineSuggestion): void {
		acceptingSuggestion = suggestion;
		draftFormElement?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	}

	type Section = Readonly<{
		status: RoutineStatus;
		heading: string;
		description: string;
		empty: string;
	}>;

	const sections: readonly Section[] = [
		{
			status: 'draft',
			heading: 'Drafts',
			description: 'Stored but never run. Promote a draft when it is ready to prove itself.',
			empty: 'No drafts. Author one below, or accept a suggestion.',
		},
		{
			status: 'candidate',
			heading: 'Candidates',
			description: 'Triggered runs stop here and wait for your confirmation.',
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

<main class="native-band-row-reserve h-full min-h-0 overflow-y-auto" data-testid="routines-page">
	<div class="mx-auto w-full max-w-[720px] space-y-6 px-6 py-6">
		<header class="space-y-3">
			<Button
				href="/"
				variant="ghost"
				size="sm"
				ariaLabel="Back to workstreams"
				data-testid="routines-back"
			>
				<Icon name="chevron-left" size={14} />
				Back
			</Button>
			<div>
				<h1 class="text-fg-default text-sm font-semibold">Routines</h1>
				<p class="text-fg-tertiary mt-0.5 text-xs">
					A routine starts as a draft, earns a promotion to candidate where every run asks first,
					and becomes a routine that runs unattended.
				</p>
			</div>
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
					<h2 id="routines-suggested-heading" class="text-fg-default text-xs font-semibold">
						Suggested
					</h2>
					<p class="text-fg-tertiary mt-0.5 text-xs">
						Prompts you keep repeating. Accepting one starts a draft with the prompts attached as
						evidence.
					</p>
				</div>
				<ul class="space-y-2">
					{#each suggestions as suggestion (suggestion.id)}
						<RoutineSuggestionCard {suggestion} onaccept={onAcceptSuggestion} />
					{/each}
				</ul>
			</section>
		{/if}

		{#each sections as section (section.status)}
			{@const routines = routinesWithStatus(section.status)}
			<section class="space-y-3" aria-labelledby={`routines-${section.status}-heading`}>
				<div>
					<h2
						id={`routines-${section.status}-heading`}
						class="text-fg-default text-xs font-semibold"
					>
						{section.heading}
						{#if routines.length > 0}
							<span class="text-fg-tertiary font-normal">({routines.length})</span>
						{/if}
					</h2>
					<p class="text-fg-tertiary mt-0.5 text-xs">{section.description}</p>
				</div>
				{#if routines.length === 0}
					<p class="text-fg-tertiary text-xs" data-testid={`routines-${section.status}-empty`}>
						{load.state === 'ready' ? section.empty : ''}
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
			bind:this={draftFormElement}
		>
			<div>
				<h2 id="routines-new-draft-heading" class="text-fg-default text-xs font-semibold">
					New draft
				</h2>
				<p class="text-fg-tertiary mt-0.5 text-xs">
					Name it, pick its trigger, and say what it runs. It stays a draft until you promote it.
				</p>
			</div>
			<RoutineDraftForm
				suggestion={acceptingSuggestion}
				onclearsuggestion={() => (acceptingSuggestion = null)}
			/>
		</section>
	</div>
</main>
