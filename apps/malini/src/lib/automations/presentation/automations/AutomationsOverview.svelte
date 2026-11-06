<script lang="ts">
	import { prefersReducedMotion } from 'svelte/motion';
	import type {
		AutomationDefinitionRecord,
		SaveAutomationDefinitionArgs,
	} from '$contract/automations';
	import { Button } from '$hyper-ui/components/button';
	import { ComposerShell } from '$hyper-ui/components/composer-shell';
	import { EnterShortcut } from '$hyper-ui/components/enter-shortcut';
	import { Textarea } from '$hyper-ui/components/textarea';
	import { Well } from '$hyper-ui/components/well';
	import { Icon } from '$hyper-ui/icons';
	import { AUTOMATIONS_RECIPES_HREF } from '$shared/router/routes-hrefs';
	import { createAutomationCommand } from '$lib/automations/application/commands/create-automation.command';
	import { automationRunsForDefinitionQuery } from '$lib/automations/application/queries/automation-runs-for-definition.query.svelte';
	import { automationSuggestionsQuery } from '$lib/automations/application/queries/automation-suggestions.query.svelte';
	import { liveAutomationsQuery } from '$lib/automations/application/queries/live-automations.query.svelte';
	import { BUILTIN_AUTOMATIONS } from '$lib/automations/domain/builtin-automations';
	import { newAutomationStateQuery } from '$lib/automations/application/queries/new-automation-state.query.svelte';
	import AutomationRunList from '../AutomationRunList.svelte';
	import { automationsState } from './automations-state.svelte';
	import { PageSection } from '$hyper-ui/components/page-section';
	import AutomationCard from './AutomationCard.svelte';
	import AutomationDraftCard from './AutomationDraftCard.svelte';
	import AutomationSuggestionCard from './AutomationSuggestionCard.svelte';
	import RecipeCard from './RecipeCard.svelte';
	import { draftFromWords, guessWhen, RECIPES } from './recipes';
	import { triggerFor } from './triggers';

	interface Props {
		automations: readonly AutomationDefinitionRecord[];
	}

	let { automations }: Props = $props();

	const PROMPT = 'What should happen, and when?';
	const RECIPE_TEASER = 3;

	let nowMs = $state(Date.now());

	const runsFor = $derived(automationRunsForDefinitionQuery.data);
	const creating = $derived(newAutomationStateQuery.data);
	const suggestions = $derived(automationSuggestionsQuery.data);
	const unplaced = $derived(
		liveAutomationsQuery.data.filter((entry) => entry.workstreamId === null),
	);
	const reading = $derived(
		automationsState.text.trim() ? draftFromWords(automationsState.text) : null,
	);
	const readingTrigger = $derived(
		automationsState.text.trim() ? triggerFor(guessWhen(automationsState.text)) : null,
	);

	$effect(() => {
		const clock = setInterval(() => (nowMs = Date.now()), unplaced.length > 0 ? 1_000 : 30_000);
		return () => clearInterval(clock);
	});

	$effect(() => {
		automationsState.settle(creating.completed);
	});

	function reveal(node: HTMLElement): void {
		node.scrollIntoView({
			block: 'nearest',
			behavior: prefersReducedMotion.current ? 'auto' : 'smooth',
		});
	}

	function onComposerKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter' || event.isComposing || !(event.metaKey || event.ctrlKey)) return;
		event.preventDefault();
		automationsState.startDraft(automationsState.text);
	}

	function onSave(automation: Omit<SaveAutomationDefinitionArgs, 'id'>): void {
		automationsState.noteSaving(creating.completed);
		createAutomationCommand(automation);
	}
</script>

<PageSection
	title="Automations"
	description="Automations Malini runs when something happens. Say what and when, and Malini drafts the automation."
	testId="automations-overview"
>
	{#if unplaced.length > 0}
		<Well title="In progress" note={`${unplaced.length}`}>
			<div class="border-surface-50-border bg-surface-50 rounded-xl border-[0.5px] p-1">
				<AutomationRunList entries={unplaced} {nowMs} asksHere />
			</div>
		</Well>
	{/if}

	<Well title={PROMPT}>
		<ComposerShell testId="automations-composer">
			<Textarea
				bare
				autoGrow
				rows={2}
				bind:value={automationsState.text}
				ariaLabel={PROMPT}
				placeholder="When a pull request merges, record what changed with Grip and post the link to Slack"
				textareaClass="min-h-16 px-4 pt-3.5 pb-1 text-sm leading-6"
				onkeydown={onComposerKeydown}
			/>
			{#snippet footer()}
				<div class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 pl-1 text-xs">
					{#if reading && readingTrigger}
						<span class="text-fg-tertiary">Malini reads</span>
						<span
							class="border-chip-border bg-chip text-fg-secondary inline-flex h-6 items-center gap-1 rounded-md border-[0.5px] px-1.5"
						>
							<Icon name={readingTrigger.icon} size={12} />
							{readingTrigger.label}
						</span>
						{#if reading.steps.length > 0}
							<span class="text-fg-tertiary">
								then {reading.steps.length}
								{reading.steps.length === 1 ? 'step' : 'steps'}{reading.then ? ', then' : ''}
							</span>
						{/if}
						{#if reading.then}
							<span
								class="border-chip-border bg-chip text-fg-secondary inline-flex h-6 items-center gap-1 rounded-md border-[0.5px] px-1.5"
							>
								<Icon name="arrow-right" size={12} />
								{BUILTIN_AUTOMATIONS[reading.then].name}
							</span>
						{/if}
					{:else}
						<span class="text-fg-tertiary flex items-center gap-1.5">
							<Icon name="sparkles" size={13} />
							Say when it should run and what it should do.
						</span>
					{/if}
				</div>
				<Button
					variant="primary"
					size="sm"
					disabled={!automationsState.text.trim()}
					onclick={() => automationsState.startDraft(automationsState.text)}
				>
					Draft it
					{#snippet trailing()}
						<EnterShortcut mod size={11} />
					{/snippet}
				</Button>
			{/snippet}
		</ComposerShell>

		{#if automationsState.draft}
			{#key automationsState.draft.key}
				<div class="scroll-mt-2" {@attach reveal}>
					<AutomationDraftCard
						text={automationsState.draft.text}
						title={automationsState.draft.title}
						{automations}
						saving={creating.busy}
						error={automationsState.savingSince === null ? null : creating.error}
						onsave={onSave}
						ondiscard={() => automationsState.discardDraft()}
					/>
				</div>
			{/key}
		{/if}
	</Well>

	{#if suggestions.length > 0}
		<Well title="Suggested" note={`${suggestions.length}`}>
			<ul class="flex flex-col gap-3">
				{#each suggestions as suggestion (suggestion.id)}
					<li>
						<AutomationSuggestionCard {suggestion} />
					</li>
				{/each}
			</ul>
		</Well>
	{/if}

	<Well title="Your automations" note={`${automations.length}`}>
		<ul class="grid grid-cols-1 gap-1.5 @2xl:grid-cols-2">
			{#each automations as automation (automation.id)}
				<li class="flex">
					<AutomationCard {automation} last={runsFor(automation.id)[0] ?? null} {nowMs} />
				</li>
			{/each}
		</ul>
	</Well>

	<Well title="Start from a recipe" note={`${RECIPE_TEASER} of ${RECIPES.length}`}>
		{#snippet trailing()}
			<Button variant="ghost" size="sm" href={AUTOMATIONS_RECIPES_HREF}>
				All recipes
				{#snippet trailing()}
					<Icon name="chevron-right" size={12} />
				{/snippet}
			</Button>
		{/snippet}
		<ul class="grid grid-cols-1 gap-1.5 @2xl:grid-cols-3">
			{#each RECIPES.slice(0, RECIPE_TEASER) as recipe (recipe.id)}
				<li class="flex">
					<RecipeCard {recipe} onuse={() => automationsState.startDraft(recipe.sentence)} />
				</li>
			{/each}
		</ul>
	</Well>
</PageSection>
