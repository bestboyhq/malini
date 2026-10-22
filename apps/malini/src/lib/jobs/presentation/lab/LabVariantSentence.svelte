<script lang="ts">
	import type { Snippet } from 'svelte';
	import { isAutomaticJobBuiltin, type JobDefinitionRecord } from '$contract/jobs';
	import { Badge } from '$hyper-ui/components/badge';
	import { Button } from '$hyper-ui/components/button';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { Icon, type IconName } from '$hyper-ui/icons';
	import { catalogModelLabel, modelCatalogQuery } from '$shared/providers/providers.api';
	import { jobRunsForDefinitionQuery } from '$lib/jobs/application/queries/job-runs-for-definition.query.svelte';
	import {
		JOB_OUTPUT_OPTIONS,
		JOB_RUNS_IN_OPTIONS,
		effortLabel,
		instructionsPreview,
	} from '../job-definition-copy';
	import JobEditor from '../JobEditor.svelte';
	import JobRecentRuns from '../JobRecentRuns.svelte';
	import { JOB_RUN_STATUS } from '../job-run-status';
	import { jobRunTime } from '../job-run-time';
	import {
		LAB_RUN_MODES,
		labIsManual,
		labSentence,
		labTrigger,
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

	type Group = Readonly<{ key: string; heading: string; match: (setup: LabJobSetup) => boolean }>;

	const GROUPS: readonly Group[] = [
		{
			key: 'auto',
			heading: 'Run on their own',
			match: (setup) => !labIsManual(setup) && setup.mode === 'auto',
		},
		{
			key: 'ask',
			heading: 'Ask you first',
			match: (setup) => !labIsManual(setup) && setup.mode === 'ask',
		},
		{ key: 'manual', heading: 'When you run them', match: labIsManual },
		{ key: 'off', heading: 'Off', match: (setup) => !labIsManual(setup) && setup.mode === 'off' },
	];

	let selectedId = $state<string | null>(null);
	let editing = $state(false);
	let nowMs = $state(Date.now());

	const runsFor = $derived(jobRunsForDefinitionQuery.data);
	const catalog = $derived(modelCatalogQuery.data);
	const selected = $derived(jobs.find((job) => job.id === selectedId) ?? jobs[0] ?? null);
	const setup = $derived(selected ? setupOf(selected) : null);

	$effect(() => {
		const clock = setInterval(() => (nowMs = Date.now()), 30_000);
		return () => clearInterval(clock);
	});

	function onSelect(job: JobDefinitionRecord): void {
		selectedId = job.id;
		editing = false;
	}

	function modeHint(mode: LabRunMode): string {
		return LAB_RUN_MODES.find((option) => option.value === mode)?.hint ?? '';
	}
</script>

<div class="flex min-h-0 flex-1" data-testid="lab-sentence">
	<nav class="flex w-72 shrink-0 flex-col" aria-label="Jobs">
		<div class="px-3 pt-1 pb-3">
			<Button variant="secondary" size="sm" class="w-full">
				{#snippet leading()}
					<Icon name="plus" size={14} />
				{/snippet}
				New job
			</Button>
		</div>
		<ScrollableDiv class="min-h-0 flex-1" ariaLabel="Job list">
			<div class="flex flex-col gap-5 px-3 pb-6">
				{#each GROUPS as group (group.key)}
					{@const members = jobs.filter((job) => group.match(setupOf(job)))}
					{#if members.length > 0}
						<section aria-label={group.heading}>
							<h2
								class="text-fg-tertiary flex items-center gap-1.5 px-2 pb-1.5 text-xs font-medium"
							>
								{group.heading}
								<span class="tabular-nums">{members.length}</span>
							</h2>
							<ul class="flex flex-col gap-px">
								{#each members as job (job.id)}
									{@const last = runsFor(job.id)[0] ?? null}
									{@const trigger = labTrigger(setupOf(job))}
									<li>
										<Button
											bare
											{...job.id === selected?.id ? { ariaCurrent: 'page' as const } : {}}
											class={[
												'sidebar-row w-full items-start gap-2 px-2 text-left',
												job.id === selected?.id ? 'sidebar-row-active' : 'text-fg-secondary',
											]}
											onclick={() => onSelect(job)}
										>
											<span class="text-fg-tertiary mt-0.5 grid size-4 shrink-0 place-items-center">
												<Icon name={trigger.icon} size={13} />
											</span>
											<span class="min-w-0 flex-1">
												<span class="text-fg-default block truncate text-sm">{job.name}</span>
												<span class="text-fg-tertiary block truncate text-xs">{trigger.label}</span>
											</span>
											{#if last}
												<span
													class={[
														'text-2xs mt-0.5 flex shrink-0 items-center gap-1 tabular-nums',
														JOB_RUN_STATUS[last.status].tone,
													]}
												>
													<Icon name={JOB_RUN_STATUS[last.status].icon} size={11} />
													<span class="text-fg-tertiary">{jobRunTime(last, nowMs)}</span>
												</span>
											{/if}
										</Button>
									</li>
								{/each}
							</ul>
						</section>
					{/if}
				{/each}
			</div>
		</ScrollableDiv>
	</nav>

	<ScrollableDiv class="min-w-0 flex-1" ariaLabel="Job">
		{#if selected && setup}
			{@const automatic = isAutomaticJobBuiltin(selected.builtin)}
			{@const manual = labIsManual(setup)}
			<article
				class="mx-auto flex w-full max-w-[760px] flex-col gap-8 px-8 pt-1 pb-16"
				aria-labelledby="lab-sentence-heading"
			>
				<header class="flex items-start gap-3">
					<div class="min-w-0 flex-1">
						<div class="flex min-w-0 items-center gap-2">
							<h2
								id="lab-sentence-heading"
								class="text-fg-default truncate text-lg font-semibold tracking-tight"
							>
								{selected.name}
							</h2>
							{#if selected.builtin !== null}
								<Badge>Built-in</Badge>
							{/if}
						</div>
						<p class="text-fg-secondary mt-1 text-sm leading-6">{labSentence(selected, setup)}</p>
					</div>
					{#if !automatic}
						<Button variant="primary" size="sm">
							{#snippet leading()}
								<Icon name="play" size={13} />
							{/snippet}
							Run now
						</Button>
					{/if}
				</header>

				<section
					class="border-surface-50-border bg-surface-50 rounded-2xl border-[0.5px]"
					aria-label="How it runs"
				>
					{#snippet step(icon: IconName, label: string, body: Snippet)}
						<div class="relative grid grid-cols-[28px_64px_1fr] items-center gap-3 px-4 py-3">
							<span
								class="border-chip-border bg-chip text-fg-secondary relative z-[1] grid size-7 place-items-center rounded-full border-[0.5px]"
							>
								<Icon name={icon} size={13} />
							</span>
							<span class="text-fg-tertiary text-xs font-medium">{label}</span>
							<div class="flex min-w-0 flex-wrap items-center gap-2">{@render body()}</div>
						</div>
					{/snippet}

					<div class="relative">
						<span
							class="bg-surface-50-border absolute top-7 bottom-7 left-[29.5px] w-px"
							aria-hidden="true"
						></span>
						{#snippet whenBody()}
							<LabTriggerButton
								{setup}
								jobName={selected.name}
								onchange={(next) => onsetup(selected, next)}
							/>
						{/snippet}
						{@render step(labTrigger(setup).icon, 'When', whenBody)}

						{#snippet doBody()}
							<span class="text-fg-default min-w-0 truncate text-sm">
								{instructionsPreview(selected.instructions)}
							</span>
						{/snippet}
						{@render step('sparkles', 'Do', doBody)}

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
							{@render step('folder-open', 'Where', whereBody)}

							{#snippet thenBody()}
								<LabChoiceMenu
									value={setup.output ?? selected.output}
									options={JOB_OUTPUT_OPTIONS}
									ariaLabel="When it finishes"
									icon="pr-draft"
									onchange={(output) => onsetup(selected, { ...setup, output })}
								/>
							{/snippet}
							{@render step('check', 'Then', thenBody)}
						{/if}
					</div>

					<div class="border-surface-50-border flex items-center gap-3 border-t-[0.5px] px-4 py-3">
						{#if manual}
							<Icon name="play" size={13} class="text-fg-tertiary" />
							<p class="text-fg-tertiary text-xs">
								Runs only when you start it: type / in any chat, or press Run now.
							</p>
						{:else}
							<LabRunsMode
								value={setup.mode}
								label={`How ${selected.name} runs`}
								onchange={(mode) => onsetup(selected, { ...setup, mode })}
							/>
							<p class="text-fg-tertiary min-w-0 flex-1 truncate text-xs">{modeHint(setup.mode)}</p>
						{/if}
					</div>
				</section>

				{#if !automatic || runsFor(selected.id).length > 0}
					<JobRecentRuns definitionId={selected.id} />
				{/if}

				<section class="flex flex-col gap-3" aria-labelledby="lab-sentence-setup">
					<div class="flex items-center gap-2">
						<h3 id="lab-sentence-setup" class="text-fg-default flex-1 text-sm font-medium">
							Instructions
						</h3>
						<Button variant="ghost" size="sm" onclick={() => (editing = !editing)}>
							{editing ? 'Done' : 'Edit'}
						</Button>
					</div>
					{#if editing}
						<JobEditor definition={selected} />
					{:else}
						<p class="text-fg-secondary line-clamp-3 text-xs leading-5 whitespace-pre-line">
							{selected.instructions}
						</p>
						<div class="flex flex-wrap items-center gap-1.5">
							<Badge>{catalogModelLabel(catalog, selected.model)}</Badge>
							{#if !automatic}
								<Badge>{effortLabel(selected.effort)} effort</Badge>
							{/if}
							{#if selected.skills.length > 0}
								{#each selected.skills as skill (skill)}
									<Badge>{skill}</Badge>
								{/each}
							{:else if !automatic}
								<Badge>Every skill that is on</Badge>
							{/if}
						</div>
					{/if}
				</section>
			</article>
		{/if}
	</ScrollableDiv>
</div>
