<script lang="ts">
	import { prefersReducedMotion } from 'svelte/motion';
	import type { JobDefinitionRecord } from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { ComposerShell } from '$hyper-ui/components/composer-shell';
	import { EnterShortcut } from '$hyper-ui/components/enter-shortcut';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { Textarea } from '$hyper-ui/components/textarea';
	import { Icon } from '$hyper-ui/icons';
	import { jobRunsForDefinitionQuery } from '$lib/jobs/application/queries/job-runs-for-definition.query.svelte';
	import { LAB_RECIPES, labDraft, labGuessTriggerId } from './lab-recipes';
	import { labState } from './lab-state.svelte';
	import { LAB_MANUAL_TRIGGER_ID, labTrigger, type LabRunMode } from './lab-triggers';
	import LabDraftCard from './LabDraftCard.svelte';
	import LabJobCard from './LabJobCard.svelte';
	import LabRecipeCard from './LabRecipeCard.svelte';

	interface Props {
		jobs: readonly JobDefinitionRecord[];
	}

	let { jobs }: Props = $props();

	const PROMPT = 'What should happen, and when?';
	const RECIPE_TEASER = 3;
	const modeBeforeOff: Record<string, LabRunMode> = {};

	let nowMs = $state(Date.now());

	const runsFor = $derived(jobRunsForDefinitionQuery.data);
	const reading = $derived(labState.text.trim() ? labDraft(labState.text) : null);
	const readingTrigger = $derived(
		labState.text.trim()
			? labTrigger({ triggerId: labGuessTriggerId(labState.text), mode: 'auto' })
			: null,
	);

	$effect(() => {
		const clock = setInterval(() => (nowMs = Date.now()), 30_000);
		return () => clearInterval(clock);
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
		labState.startDraft(labState.text);
	}

	function onToggle(job: JobDefinitionRecord, on: boolean): void {
		const setup = labState.setupOf(job);
		if (on) {
			labState.setSetup(job, { ...setup, mode: modeBeforeOff[job.id] ?? 'auto' });
			return;
		}
		modeBeforeOff[job.id] = setup.mode;
		labState.setSetup(job, { ...setup, mode: 'off' });
	}
</script>

{#snippet sectionHeading(id: string, heading: string, note: string)}
	<div class="flex items-baseline gap-2 px-0.5">
		<h2 {id} class="text-fg-default text-sm font-semibold">{heading}</h2>
		<p class="text-fg-tertiary min-w-0 truncate text-xs">{note}</p>
	</div>
{/snippet}

<ScrollableDiv class="min-h-0 flex-1" ariaLabel="Automations">
	<div
		class="mx-auto flex w-full max-w-[880px] flex-col gap-12 px-10 pt-12 pb-16"
		data-testid="lab-overview"
	>
		<section class="flex flex-col gap-4" aria-labelledby="lab-overview-prompt">
			<h1
				id="lab-overview-prompt"
				class="text-fg-default text-center text-2xl font-semibold tracking-tight"
			>
				{PROMPT}
			</h1>
			<ComposerShell testId="lab-overview-composer">
				<Textarea
					bare
					autoGrow
					rows={2}
					bind:value={labState.text}
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
								{readingTrigger.id === LAB_MANUAL_TRIGGER_ID
									? 'When you run it'
									: readingTrigger.label}
							</span>
							{#if reading.steps.length > 0}
								<span class="text-fg-tertiary">
									then {reading.steps.length}
									{reading.steps.length === 1 ? 'step' : 'steps'}
								</span>
							{/if}
							{#each reading.tools as tool (tool)}
								<span
									class="border-chip-border bg-chip text-fg-secondary inline-flex h-6 items-center gap-1 rounded-md border-[0.5px] px-1.5"
								>
									<Icon name="plug" size={11} />
									{tool}
								</span>
							{/each}
						{:else}
							<span class="text-fg-tertiary flex items-center gap-1.5">
								<Icon name="sparkles" size={13} />
								Say when it should run and what it should do. Malini drafts the rest.
							</span>
						{/if}
					</div>
					<Button
						variant="primary"
						size="sm"
						disabled={!labState.text.trim()}
						onclick={() => labState.startDraft(labState.text)}
					>
						Draft it
						{#snippet trailing()}
							<EnterShortcut mod size={11} />
						{/snippet}
					</Button>
				{/snippet}
			</ComposerShell>

			{#if labState.draft}
				{#key labState.draft.key}
					<div class="scroll-mt-6" {@attach reveal}>
						<LabDraftCard
							text={labState.draft.text}
							title={labState.draft.title}
							onsave={(draft) => labState.saveDraft(draft)}
							ondiscard={() => (labState.draft = null)}
						/>
					</div>
				{/key}
			{/if}
		</section>

		<section class="flex flex-col gap-3" aria-labelledby="lab-overview-jobs">
			{@render sectionHeading('lab-overview-jobs', 'Your jobs', `${jobs.length}`)}
			<ul class="grid grid-cols-2 gap-3">
				{#each jobs as job (job.id)}
					<li class="flex">
						<LabJobCard
							{job}
							setup={labState.setupOf(job)}
							last={runsFor(job.id)[0] ?? null}
							{nowMs}
							onopen={() => (labState.selectedJobId = job.id)}
							ontoggle={(on) => onToggle(job, on)}
						/>
					</li>
				{/each}
			</ul>
		</section>

		<section class="flex flex-col gap-3" aria-labelledby="lab-overview-recipes">
			<div class="flex items-center gap-2">
				<div class="min-w-0 flex-1">
					{@render sectionHeading(
						'lab-overview-recipes',
						'Start from a recipe',
						'One click drafts it. Then make it yours.',
					)}
				</div>
				<Button variant="ghost" size="sm" onclick={() => (labState.section = 'recipes')}>
					All recipes
					{#snippet trailing()}
						<Icon name="chevron-right" size={12} />
					{/snippet}
				</Button>
			</div>
			<ul class="grid grid-cols-3 gap-3">
				{#each LAB_RECIPES.slice(0, RECIPE_TEASER) as recipe (recipe.id)}
					<li class="flex">
						<LabRecipeCard {recipe} onuse={() => labState.startDraft(recipe.sentence)} />
					</li>
				{/each}
			</ul>
		</section>
	</div>
</ScrollableDiv>
