<script lang="ts">
	import type { JobDefinitionRecord } from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { ComposerShell } from '$hyper-ui/components/composer-shell';
	import { EnterShortcut } from '$hyper-ui/components/enter-shortcut';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { Textarea } from '$hyper-ui/components/textarea';
	import { Icon } from '$hyper-ui/icons';
	import { DEFAULT_AGENT_MODEL, DEFAULT_AGENT_RUN_PROFILE } from '$shared/providers/providers.api';
	import { jobRunsForDefinitionQuery } from '$lib/jobs/application/queries/job-runs-for-definition.query.svelte';
	import {
		LAB_RECIPES,
		labDraft,
		labGuessTriggerId,
		type LabRecipe,
		type LabSavedDraft,
	} from './lab-recipes';
	import {
		LAB_MANUAL_TRIGGER_ID,
		labTrigger,
		labWhenClause,
		type LabJobSetup,
		type LabRunMode,
	} from './lab-triggers';
	import LabActivityRail from './LabActivityRail.svelte';
	import LabDraftCard from './LabDraftCard.svelte';
	import LabJobCard from './LabJobCard.svelte';
	import LabJobSheet from './LabJobSheet.svelte';

	interface Props {
		jobs: readonly JobDefinitionRecord[];
		setupOf: (definition: JobDefinitionRecord) => LabJobSetup;
		onsetup: (definition: JobDefinitionRecord, setup: LabJobSetup) => void;
	}

	let { jobs, setupOf, onsetup }: Props = $props();

	const PROMPT = 'What should happen, and when?';
	const LOCAL_PREFIX = 'lab-draft-';
	const modeBeforeOff: Record<string, LabRunMode> = {};

	let text = $state('');
	let draftText = $state<string | null>(null);
	let draftTitle = $state<string | undefined>(undefined);
	let draftKey = $state(0);
	let created = $state<readonly JobDefinitionRecord[]>([]);
	let composerSection = $state<HTMLElement | null>(null);
	let selectedId = $state<string | null>(null);
	let nowMs = $state(Date.now());

	const runsFor = $derived(jobRunsForDefinitionQuery.data);
	const allJobs = $derived([...created, ...jobs]);
	const selected = $derived(allJobs.find((job) => job.id === selectedId) ?? null);
	const reading = $derived(text.trim() ? labDraft(text) : null);
	const readingTrigger = $derived(
		text.trim() ? labTrigger({ triggerId: labGuessTriggerId(text), mode: 'auto' }) : null,
	);

	$effect(() => {
		const clock = setInterval(() => (nowMs = Date.now()), 30_000);
		return () => clearInterval(clock);
	});

	function onDraft(): void {
		if (!text.trim()) return;
		draftText = text.trim();
		draftTitle = LAB_RECIPES.find((recipe) => recipe.sentence === draftText)?.title;
		draftKey += 1;
	}

	function onComposerKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter' || event.isComposing || !(event.metaKey || event.ctrlKey)) return;
		event.preventDefault();
		onDraft();
	}

	function onUse(recipe: LabRecipe): void {
		text = recipe.sentence;
		onDraft();
		const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		composerSection?.scrollIntoView({
			block: 'start',
			behavior: reducedMotion ? 'auto' : 'smooth',
		});
	}

	function onSave(draft: LabSavedDraft): void {
		const now = new Date().toISOString();
		const record: JobDefinitionRecord = {
			id: `${LOCAL_PREFIX}${created.length + 1}`,
			name: draft.name,
			instructions: draft.steps.map((step, index) => `${index + 1}. ${step}`).join('\n'),
			model: DEFAULT_AGENT_MODEL,
			effort: DEFAULT_AGENT_RUN_PROFILE.effort,
			runsIn: draft.setup.runsIn ?? 'workstream',
			output: draft.setup.output ?? 'none',
			skills: [],
			builtin: null,
			createdAt: now,
			updatedAt: now,
		};
		created = [record, ...created];
		onsetup(record, draft.setup);
		draftText = null;
		text = '';
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
</script>

{#snippet sectionHeading(id: string, heading: string, note: string)}
	<div class="flex items-baseline gap-2 px-0.5">
		<h2 {id} class="text-fg-default text-sm font-semibold">{heading}</h2>
		<p class="text-fg-tertiary min-w-0 truncate text-xs">{note}</p>
	</div>
{/snippet}

<div class="flex min-h-0 flex-1" data-testid="lab-center">
	<ScrollableDiv class="min-w-0 flex-1" ariaLabel="Automations">
		<div class="mx-auto flex w-full max-w-[880px] flex-col gap-12 px-10 pt-4 pb-16">
			<section
				bind:this={composerSection}
				class="flex scroll-mt-4 flex-col gap-4"
				aria-labelledby="lab-center-prompt"
			>
				<h2
					id="lab-center-prompt"
					class="text-fg-default text-center text-2xl font-semibold tracking-tight"
				>
					{PROMPT}
				</h2>
				<ComposerShell testId="lab-center-composer">
					<Textarea
						bare
						autoGrow
						rows={2}
						bind:value={text}
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
						<Button variant="primary" size="sm" disabled={!text.trim()} onclick={onDraft}>
							Draft it
							{#snippet trailing()}
								<EnterShortcut mod size={11} />
							{/snippet}
						</Button>
					{/snippet}
				</ComposerShell>

				{#if draftText}
					{#key draftKey}
						<LabDraftCard
							text={draftText}
							title={draftTitle}
							onsave={onSave}
							ondiscard={() => (draftText = null)}
						/>
					{/key}
				{/if}
			</section>

			<section class="flex flex-col gap-3" aria-labelledby="lab-center-jobs">
				{@render sectionHeading('lab-center-jobs', 'Your jobs', `${allJobs.length}`)}
				<ul class="grid grid-cols-2 gap-3">
					{#each allJobs as job (job.id)}
						<li class="flex">
							<LabJobCard
								{job}
								setup={setupOf(job)}
								last={runsFor(job.id)[0] ?? null}
								{nowMs}
								onopen={() => (selectedId = job.id)}
								ontoggle={(on) => onToggle(job, on)}
							/>
						</li>
					{/each}
				</ul>
			</section>

			<section class="flex flex-col gap-3" aria-labelledby="lab-center-recipes">
				{@render sectionHeading(
					'lab-center-recipes',
					'Start from a recipe',
					'One click drafts it. Then make it yours.',
				)}
				<ul class="grid grid-cols-3 gap-3">
					{#each LAB_RECIPES as recipe (recipe.id)}
						{@const setup = { triggerId: recipe.triggerId, mode: 'auto' as const }}
						<li class="flex">
							<article
								class="border-surface-50-border bg-surface-50 flex w-full flex-col gap-3 rounded-xl border-[0.5px] p-4"
								aria-label={recipe.title}
							>
								<div class="flex min-w-0 items-center gap-2">
									<span
										class="border-chip-border bg-chip text-fg-secondary grid size-6 shrink-0 place-items-center rounded-md border-[0.5px]"
										aria-hidden="true"
									>
										<Icon name={labTrigger(setup).icon} size={13} />
									</span>
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
	<LabActivityRail {jobs} {setupOf} />
</div>

{#if selected}
	<LabJobSheet
		job={selected}
		setup={setupOf(selected)}
		editable={!selected.id.startsWith(LOCAL_PREFIX)}
		onsetup={(next) => onsetup(selected, next)}
		onclose={() => (selectedId = null)}
	/>
{/if}
