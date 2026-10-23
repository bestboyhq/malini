<script lang="ts">
	import { prefersReducedMotion } from 'svelte/motion';
	import type { JobDefinitionRecord, SaveJobDefinitionArgs } from '$contract/jobs';
	import type { JobTrigger } from '$contract/routines';
	import { Button } from '$hyper-ui/components/button';
	import { ComposerShell } from '$hyper-ui/components/composer-shell';
	import { EnterShortcut } from '$hyper-ui/components/enter-shortcut';
	import { Textarea } from '$hyper-ui/components/textarea';
	import { Well } from '$hyper-ui/components/well';
	import { Icon } from '$hyper-ui/icons';
	import { JOBS_RECIPES_HREF } from '$shared/router/routes-hrefs';
	import { jobRunsForDefinitionQuery } from '$lib/jobs/application/queries/job-runs-for-definition.query.svelte';
	import { automationsState, type ActionState } from './automations-state.svelte';
	import AutomationsSection from './AutomationsSection.svelte';
	import JobCard from './JobCard.svelte';
	import JobDraftCard from './JobDraftCard.svelte';
	import RecipeCard from './RecipeCard.svelte';
	import { draftFromWords, guessTriggerId, RECIPES } from './recipes';
	import { triggerById } from './triggers';

	interface Props {
		jobs: readonly JobDefinitionRecord[];
		triggerOf: (jobId: string) => JobTrigger | null;
		triggerStateOf: (jobId: string) => ActionState;
		creating: ActionState & Readonly<{ completed: number }>;
		ontrigger: (job: JobDefinitionRecord, trigger: JobTrigger | null) => void;
		oncreate: (job: Omit<SaveJobDefinitionArgs, 'id'>, trigger: JobTrigger | null) => void;
	}

	let { jobs, triggerOf, triggerStateOf, creating, ontrigger, oncreate }: Props = $props();

	const PROMPT = 'What should happen, and when?';
	const RECIPE_TEASER = 3;

	let nowMs = $state(Date.now());

	const runsFor = $derived(jobRunsForDefinitionQuery.data);
	const reading = $derived(
		automationsState.text.trim() ? draftFromWords(automationsState.text) : null,
	);
	const readingTrigger = $derived(
		automationsState.text.trim() ? triggerById(guessTriggerId(automationsState.text)) : null,
	);

	$effect(() => {
		const clock = setInterval(() => (nowMs = Date.now()), 30_000);
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

	function onSave(job: Omit<SaveJobDefinitionArgs, 'id'>, trigger: JobTrigger | null): void {
		automationsState.noteSaving(creating.completed);
		oncreate(job, trigger);
	}
</script>

<AutomationsSection
	title="Automations"
	description="Jobs Malini runs when something happens. Say what and when, and Malini drafts the job."
	testId="automations-overview"
>
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
								{reading.steps.length === 1 ? 'step' : 'steps'}
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
					<JobDraftCard
						text={automationsState.draft.text}
						title={automationsState.draft.title}
						saving={creating.busy}
						error={automationsState.savingSince === null ? null : creating.error}
						onsave={onSave}
						ondiscard={() => automationsState.discardDraft()}
					/>
				</div>
			{/key}
		{/if}
	</Well>

	<Well title="Your jobs" note={`${jobs.length}`}>
		<ul class="grid grid-cols-1 gap-1.5 @2xl:grid-cols-2">
			{#each jobs as job (job.id)}
				<li class="flex">
					<JobCard
						{job}
						trigger={triggerOf(job.id)}
						triggerState={triggerStateOf(job.id)}
						last={runsFor(job.id)[0] ?? null}
						{nowMs}
						ontrigger={(trigger) => ontrigger(job, trigger)}
					/>
				</li>
			{/each}
		</ul>
	</Well>

	<Well title="Start from a recipe" note={`${RECIPE_TEASER} of ${RECIPES.length}`}>
		{#snippet trailing()}
			<Button variant="ghost" size="sm" href={JOBS_RECIPES_HREF}>
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
</AutomationsSection>
