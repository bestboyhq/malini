<script lang="ts">
	import type { Snippet } from 'svelte';
	import { isAutomaticJobBuiltin, type JobDefinitionRecord } from '$contract/jobs';
	import { Badge } from '$hyper-ui/components/badge';
	import { Button } from '$hyper-ui/components/button';
	import { ComposerShell } from '$hyper-ui/components/composer-shell';
	import { EnterShortcut } from '$hyper-ui/components/enter-shortcut';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { Sheet } from '$hyper-ui/components/sheet';
	import { Switch } from '$hyper-ui/components/switch';
	import { Textarea } from '$hyper-ui/components/textarea';
	import { Icon, type IconName } from '$hyper-ui/icons';
	import { jobRunsForDefinitionQuery } from '$lib/jobs/application/queries/job-runs-for-definition.query.svelte';
	import {
		JOB_OUTPUT_OPTIONS,
		JOB_RUNS_IN_OPTIONS,
		instructionsPreview,
	} from '../job-definition-copy';
	import JobEditor from '../JobEditor.svelte';
	import JobRecentRuns from '../JobRecentRuns.svelte';
	import { JOB_RUN_STATUS } from '../job-run-status';
	import { jobRunTime } from '../job-run-time';
	import { LAB_RECIPES, labDraftWork, labGuessTriggerId, type LabRecipe } from './lab-recipes';
	import {
		LAB_RUN_MODES,
		labIsManual,
		labSentence,
		labTrigger,
		labWhenClause,
		type LabJobSetup,
		type LabRunMode,
	} from './lab-triggers';
	import LabChoiceMenu from './LabChoiceMenu.svelte';
	import LabRunsMode from './LabRunsMode.svelte';
	import LabTriggerButton from './LabTriggerButton.svelte';

	interface Props {
		jobs: readonly JobDefinitionRecord[];
		setupOf: (definition: JobDefinitionRecord) => LabJobSetup;
		onsetup: (definition: JobDefinitionRecord, setup: LabJobSetup) => void;
	}

	let { jobs, setupOf, onsetup }: Props = $props();

	type Draft = Readonly<{ work: string; setup: LabJobSetup }>;

	const PROMPT = 'What should happen, and when?';
	const modeBeforeOff: Record<string, LabRunMode> = {};

	let text = $state('');
	let draft = $state<Draft | null>(null);
	let composer = $state<HTMLTextAreaElement | null>(null);
	let selectedId = $state<string | null>(null);
	let nowMs = $state(Date.now());

	const runsFor = $derived(jobRunsForDefinitionQuery.data);
	const selected = $derived(jobs.find((job) => job.id === selectedId) ?? null);
	const canDraft = $derived(text.trim().length > 0);

	$effect(() => {
		const clock = setInterval(() => (nowMs = Date.now()), 30_000);
		return () => clearInterval(clock);
	});

	function onDraft(): void {
		if (!canDraft) return;
		draft = {
			work: labDraftWork(text),
			setup: { triggerId: labGuessTriggerId(text), mode: 'auto' },
		};
	}

	function onComposerKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter' || event.isComposing || !(event.metaKey || event.ctrlKey)) return;
		event.preventDefault();
		onDraft();
	}

	function onDraftTrigger(setup: LabJobSetup): void {
		if (draft) draft = { ...draft, setup };
	}

	function onCreate(): void {
		draft = null;
		text = '';
	}

	function onUse(recipe: LabRecipe): void {
		text = recipe.sentence;
		draft = null;
		const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		composer?.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
		composer?.focus({ preventScroll: true });
	}

	function onToggle(job: JobDefinitionRecord, on: boolean): void {
		const setup = setupOf(job);
		if (on) {
			onsetup(job, { ...setup, mode: modeBeforeOff[job.id] ?? 'auto' });
			return;
		}
		modeBeforeOff[job.id] = setup.mode;
		onsetup(job, { ...setup, mode: 'off' });
	}

	function recipeSetup(recipe: LabRecipe): LabJobSetup {
		return { triggerId: recipe.triggerId, mode: 'auto' };
	}

	function modeCopy(mode: LabRunMode): Readonly<{ label: string; hint: string }> {
		return LAB_RUN_MODES.find((option) => option.value === mode) ?? { label: '', hint: '' };
	}
</script>

{#snippet triggerChip(icon: IconName)}
	<span
		class="border-chip-border bg-chip text-fg-secondary grid size-6 shrink-0 place-items-center rounded-md border-[0.5px]"
		aria-hidden="true"
	>
		<Icon name={icon} size={13} />
	</span>
{/snippet}

{#snippet sectionHeading(id: string, heading: string, note: string)}
	<div class="flex items-baseline gap-2 px-0.5">
		<h2 {id} class="text-fg-default text-sm font-semibold">{heading}</h2>
		<p class="text-fg-tertiary min-w-0 truncate text-xs">{note}</p>
	</div>
{/snippet}

{#snippet setupRow(label: string, body: Snippet)}
	<div
		class="border-surface-50-border grid grid-cols-[56px_1fr] items-center gap-3 border-t-[0.5px] px-4 py-3 first:border-t-0"
	>
		<span class="text-fg-tertiary text-xs font-medium">{label}</span>
		<div class="flex min-w-0 flex-wrap items-center gap-2">{@render body()}</div>
	</div>
{/snippet}

<div class="flex min-h-0 flex-1" data-testid="lab-recipes">
	<ScrollableDiv class="min-h-0 flex-1" ariaLabel="Jobs">
		<div class="mx-auto flex w-full max-w-[840px] flex-col gap-12 px-8 pt-6 pb-16">
			<section class="flex flex-col gap-4" aria-labelledby="lab-recipes-prompt">
				<h2
					id="lab-recipes-prompt"
					class="text-fg-default text-center text-xl font-semibold tracking-tight"
				>
					{PROMPT}
				</h2>
				<ComposerShell testId="lab-recipes-composer">
					<Textarea
						bare
						autoGrow
						rows={2}
						bind:value={text}
						bind:element={composer}
						ariaLabel={PROMPT}
						placeholder="When a pull request merges, update the changelog"
						textareaClass="min-h-16 px-4 pt-3.5 pb-1 text-sm leading-6"
						onkeydown={onComposerKeydown}
					/>
					{#snippet footer()}
						<p class="text-fg-tertiary flex min-w-0 items-center gap-1.5 pl-1 text-xs">
							<Icon name="sparkles" size={13} class="shrink-0" />
							<span class="truncate">
								Malini's agent drafts the job. You check it before it runs.
							</span>
						</p>
						<Button variant="primary" size="sm" disabled={!canDraft} onclick={onDraft}>
							Draft it
							{#snippet trailing()}
								<EnterShortcut mod size={11} />
							{/snippet}
						</Button>
					{/snippet}
				</ComposerShell>

				{#if draft}
					{@const manual = labIsManual(draft.setup)}
					<article
						class="border-surface-50-border bg-surface-50 flex flex-col rounded-xl border-[0.5px]"
						aria-labelledby="lab-recipes-draft"
						data-testid="lab-recipes-draft"
					>
						<header class="flex items-center gap-2 px-4 pt-3.5">
							<h3 id="lab-recipes-draft" class="text-fg-default text-sm font-semibold">New job</h3>
							<Badge>Preview</Badge>
						</header>
						<div class="flex flex-wrap items-center gap-x-2.5 gap-y-2 px-4 pt-3 pb-4">
							<span class="text-fg-tertiary text-xs font-medium">When</span>
							<LabTriggerButton
								setup={draft.setup}
								jobName="the new job"
								onchange={onDraftTrigger}
							/>
							<Icon name="arrow-right" size={13} class="text-fg-tertiary shrink-0" />
							<span class="text-fg-default min-w-0 text-sm">{draft.work}</span>
						</div>
						<footer
							class="border-surface-50-border flex items-center gap-2 border-t-[0.5px] px-4 py-2.5"
						>
							<p class="text-fg-tertiary min-w-0 flex-1 truncate text-xs">
								{manual
									? 'Nothing here says when, so it runs when you run it.'
									: 'Malini picked when from your words. Change it if it is off.'}
							</p>
							<Button variant="ghost" size="sm" onclick={() => (draft = null)}>Discard</Button>
							<Button variant="primary" size="sm" onclick={onCreate}>Create job</Button>
						</footer>
					</article>
				{/if}
			</section>

			<section class="flex flex-col gap-3" aria-labelledby="lab-recipes-jobs">
				{@render sectionHeading('lab-recipes-jobs', 'Your jobs', `${jobs.length}`)}
				<ul class="grid grid-cols-2 gap-3">
					{#each jobs as job (job.id)}
						{@const setup = setupOf(job)}
						{@const manual = labIsManual(setup)}
						{@const last = runsFor(job.id)[0] ?? null}
						<li class="flex">
							<article
								class="border-surface-50-border bg-surface-50 relative flex w-full flex-col rounded-xl border-[0.5px]"
								aria-label={job.name}
							>
								<Button
									bare
									ariaLabel={`Set up ${job.name}`}
									ariaHasPopup="dialog"
									class="hover:bg-surface-50-hover focus-visible:ring-border-default/50 absolute inset-0 cursor-pointer rounded-xl outline-none focus-visible:ring-2"
									onclick={() => (selectedId = job.id)}
								/>
								<div class="pointer-events-none relative flex flex-1 flex-col gap-3 px-4 pt-4 pb-3">
									<div class="flex min-w-0 items-center gap-2">
										{@render triggerChip(labTrigger(setup).icon)}
										<span class="text-fg-tertiary min-w-0 truncate text-xs">
											{labWhenClause(setup)}
										</span>
									</div>
									<div class="flex flex-col gap-1">
										<h3 class="text-fg-default truncate text-sm font-semibold">{job.name}</h3>
										<p class="text-fg-secondary line-clamp-2 min-h-10 text-xs leading-5">
											{instructionsPreview(job.instructions)}
										</p>
									</div>
								</div>
								<div
									class="border-surface-50-border pointer-events-none relative flex h-11 items-center gap-2 border-t-[0.5px] px-4 text-xs"
								>
									{#if last}
										{@const look = JOB_RUN_STATUS[last.status]}
										<span class={['flex shrink-0 items-center gap-1', look.tone]}>
											<Icon name={look.icon} size={12} />
											{look.label}
										</span>
										<span class="text-fg-tertiary min-w-0 flex-1 truncate tabular-nums">
											{jobRunTime(last, nowMs)}
										</span>
									{:else}
										<span class="text-fg-tertiary min-w-0 flex-1 truncate">No runs yet</span>
									{/if}
									{#if manual}
										<span class="text-fg-tertiary shrink-0">Runs when you run it</span>
									{:else}
										<span class="text-fg-tertiary shrink-0">{modeCopy(setup.mode).label}</span>
										<Switch
											checked={setup.mode !== 'off'}
											ariaLabel={job.name}
											class="pointer-events-auto"
											onchange={(on) => onToggle(job, on)}
										/>
									{/if}
								</div>
							</article>
						</li>
					{/each}
				</ul>
			</section>

			<section class="flex flex-col gap-3" aria-labelledby="lab-recipes-recipes">
				{@render sectionHeading(
					'lab-recipes-recipes',
					'Start from a recipe',
					'Fill the box above, then make it yours.',
				)}
				<ul class="grid grid-cols-3 gap-3">
					{#each LAB_RECIPES as recipe (recipe.id)}
						{@const setup = recipeSetup(recipe)}
						<li class="flex">
							<article
								class="border-surface-50-border bg-surface-50 flex w-full flex-col gap-3 rounded-xl border-[0.5px] p-4"
								aria-label={recipe.title}
							>
								<div class="flex min-w-0 items-center gap-2">
									{@render triggerChip(labTrigger(setup).icon)}
									<span class="text-fg-tertiary min-w-0 truncate text-xs">
										{labWhenClause(setup)}
									</span>
								</div>
								<div class="flex flex-col gap-1">
									<h3 class="text-fg-default truncate text-sm font-semibold">{recipe.title}</h3>
									<p class="text-fg-secondary line-clamp-2 min-h-10 text-xs leading-5">
										{recipe.description}
									</p>
								</div>
								<div class="mt-auto">
									<Button
										variant="secondary"
										size="sm"
										ariaLabel={`Use ${recipe.title}`}
										onclick={() => onUse(recipe)}
									>
										Use
									</Button>
								</div>
							</article>
						</li>
					{/each}
				</ul>
			</section>
		</div>
	</ScrollableDiv>
</div>

{#if selected}
	{@const setup = setupOf(selected)}
	{@const manual = labIsManual(setup)}
	{@const automatic = isAutomaticJobBuiltin(selected.builtin)}
	<Sheet
		open
		title={selected.name}
		description={labSentence(selected, setup)}
		class="max-w-[800px]"
		onclose={() => (selectedId = null)}
	>
		<div class="flex flex-col gap-8 pt-1">
			<section
				class="border-surface-50-border bg-surface-50 flex flex-col rounded-xl border-[0.5px]"
				aria-label="How it runs"
			>
				{#snippet whenBody()}
					<LabTriggerButton
						{setup}
						jobName={selected.name}
						onchange={(next) => onsetup(selected, next)}
					/>
				{/snippet}
				{@render setupRow('When', whenBody)}

				{#snippet howBody()}
					{#if manual}
						<p class="text-fg-tertiary text-xs">Only when you start it: type / in any chat.</p>
					{:else}
						<LabRunsMode
							value={setup.mode}
							label={`How ${selected.name} runs`}
							onchange={(mode) => onsetup(selected, { ...setup, mode })}
						/>
						<p class="text-fg-tertiary min-w-0 truncate text-xs">{modeCopy(setup.mode).hint}</p>
					{/if}
				{/snippet}
				{@render setupRow('How', howBody)}

				{#if !automatic}
					{#snippet whereBody()}
						<LabChoiceMenu
							value={setup.runsIn ?? selected.runsIn}
							options={JOB_RUNS_IN_OPTIONS}
							ariaLabel="Runs in"
							icon="branch"
							onchange={(runsIn) => onsetup(selected, { ...setup, runsIn })}
						/>
					{/snippet}
					{@render setupRow('Where', whereBody)}

					{#snippet thenBody()}
						<LabChoiceMenu
							value={setup.output ?? selected.output}
							options={JOB_OUTPUT_OPTIONS}
							ariaLabel="When it finishes"
							icon="pr-draft"
							onchange={(output) => onsetup(selected, { ...setup, output })}
						/>
					{/snippet}
					{@render setupRow('Then', thenBody)}
				{/if}
			</section>

			<JobRecentRuns definitionId={selected.id} />

			<section class="flex flex-col gap-3" aria-labelledby="lab-recipes-instructions">
				<h3 id="lab-recipes-instructions" class="text-fg-default text-sm font-medium">
					Instructions
				</h3>
				<JobEditor definition={selected} />
			</section>
		</div>
	</Sheet>
{/if}
