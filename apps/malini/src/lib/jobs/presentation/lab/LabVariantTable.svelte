<script lang="ts">
	import {
		isAutomaticJobBuiltin,
		type JobDefinitionRecord,
		type JobRunRecord,
	} from '$contract/jobs';
	import { Badge } from '$hyper-ui/components/badge';
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { jobRunsForDefinitionQuery } from '$lib/jobs/application/queries/job-runs-for-definition.query.svelte';
	import { instructionsPreview } from '../job-definition-copy';
	import JobEditor from '../JobEditor.svelte';
	import JobRecentRuns from '../JobRecentRuns.svelte';
	import { JOB_RUN_STATUS } from '../job-run-status';
	import { jobRunTime } from '../job-run-time';
	import {
		LAB_RUN_MODES,
		labIsManual,
		labSentence,
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

	type Filter = 'all' | 'manual' | LabRunMode;

	type Month = Readonly<{ count: number; succeeded: number; failed: number }>;

	const FILTERS: readonly Readonly<{ value: Filter; label: string }>[] = [
		{ value: 'all', label: 'All' },
		{ value: 'auto', label: 'On its own' },
		{ value: 'ask', label: 'Ask first' },
		{ value: 'manual', label: 'When you run it' },
		{ value: 'off', label: 'Off' },
	];

	const RUNS_IN_SHORT: Readonly<Record<JobDefinitionRecord['runsIn'], string>> = {
		workstream: 'Workstream',
		'new-workstream': 'New workstream',
	};

	const OUTPUT_SHORT: Readonly<Record<JobDefinitionRecord['output'], string>> = {
		none: 'No PR',
		draft: 'Draft PR',
		merge: 'Merge',
	};

	const NARROW = {
		badge: '@max-[57rem]:hidden',
		where: '@max-[52rem]:hidden',
		month: '@max-2xl:hidden',
		last: '@max-xl:hidden',
	};

	const HEAD =
		'text-fg-tertiary border-border-default text-2xs h-8 border-b-[0.5px] px-2 font-medium whitespace-nowrap';
	const PANEL_ID = 'lab-table-panel';
	const MONTH_MS = 30 * 24 * 60 * 60 * 1_000;

	let search = $state('');
	let filter = $state<Filter>('all');
	let selectedId = $state<string | null>(null);
	let editing = $state(false);
	let nowMs = $state(Date.now());

	const runsFor = $derived(jobRunsForDefinitionQuery.data);
	const needle = $derived(search.trim().toLowerCase());
	const visible = $derived(
		jobs.filter((job) => matches(job, filter) && job.name.toLowerCase().includes(needle)),
	);
	const selected = $derived(jobs.find((job) => job.id === selectedId) ?? null);

	$effect(() => {
		const clock = setInterval(() => (nowMs = Date.now()), 30_000);
		return () => clearInterval(clock);
	});

	function matches(job: JobDefinitionRecord, option: Filter): boolean {
		if (option === 'all') return true;
		const setup = setupOf(job);
		return labIsManual(setup) ? option === 'manual' : setup.mode === option;
	}

	function onSelect(job: JobDefinitionRecord): void {
		editing = false;
		selectedId = selectedId === job.id ? null : job.id;
	}

	function lastMonth(runs: readonly JobRunRecord[]): Month {
		const recent = runs.filter((run) => nowMs - Date.parse(run.createdAt) < MONTH_MS);
		return {
			count: recent.length,
			succeeded: recent.filter((run) => run.status === 'succeeded').length,
			failed: recent.filter((run) => run.status === 'failed').length,
		};
	}

	function successRate(month: Month): number | null {
		const settled = month.succeeded + month.failed;
		return settled === 0 ? null : Math.round((month.succeeded / settled) * 100);
	}

	function modeHint(mode: LabRunMode): string {
		return LAB_RUN_MODES.find((option) => option.value === mode)?.hint ?? '';
	}
</script>

<div class="flex min-h-0 flex-1" data-testid="lab-table">
	<div class="flex min-w-0 flex-1 flex-col">
		<div class="flex shrink-0 items-center gap-3 px-6 pb-3">
			<TextInput
				bind:value={search}
				type="search"
				size="xs"
				placeholder="Search jobs"
				ariaLabel="Search jobs"
				class="w-52"
			>
				{#snippet icon()}
					<Icon name="search" size={13} />
				{/snippet}
			</TextInput>
			<div
				class="bg-surface-50 border-surface-50-border inline-flex gap-0.5 rounded-[9px] border-[0.5px] p-0.5"
				role="group"
				aria-label="Show jobs that run"
			>
				{#each FILTERS as option (option.value)}
					<Button
						size="sm"
						variant="ghost"
						active={option.value === filter}
						ariaPressed={option.value === filter}
						onclick={() => (filter = option.value)}
					>
						{option.label}
						<span class="text-fg-tertiary tabular-nums">
							{jobs.filter((job) => matches(job, option.value)).length}
						</span>
					</Button>
				{/each}
			</div>
			<Button variant="secondary" size="sm" class="ml-auto">
				{#snippet leading()}
					<Icon name="plus" size={14} />
				{/snippet}
				New job
			</Button>
		</div>

		<div class="flex min-h-0 flex-1">
			<ScrollableDiv class="min-w-0 flex-1" ariaLabel="Jobs">
				<div class="@container px-3 pb-10">
					<table class="w-full table-fixed border-separate border-spacing-0 text-left">
						<thead class="bg-surface-root sticky top-0 z-[2]">
							<tr>
								<th scope="col" class={[HEAD, 'pl-3']}>Job</th>
								<th scope="col" class={[HEAD, 'w-40']}>When</th>
								<th scope="col" class={[HEAD, 'w-28']}>Runs</th>
								<th scope="col" class={[HEAD, 'w-42', NARROW.where]}>Where → then</th>
								<th scope="col" class={[HEAD, 'w-20', NARROW.last]}>Last run</th>
								<th scope="col" class={[HEAD, 'w-24', NARROW.month]}>30 days</th>
								<th scope="col" class={[HEAD, 'w-10 pr-3']}>
									<span class="sr-only">Actions</span>
								</th>
							</tr>
						</thead>
						<tbody>
							{#each visible as job (job.id)}
								{@const setup = setupOf(job)}
								{@const current = job.id === selectedId}
								{@const automatic = isAutomaticJobBuiltin(job.builtin)}
								{@const runs = runsFor(job.id)}
								{@const last = runs[0]}
								{@const month = lastMonth(runs)}
								{@const cell = [
									'h-11 px-2',
									current ? 'bg-surface-root-selected' : 'group-hover:bg-surface-root-hover',
								]}
								<tr class="group relative">
									<td class={[cell, 'rounded-l-lg pl-3']}>
										<Button
											bare
											ariaExpanded={current}
											{...current ? { ariaControls: PANEL_ID } : {}}
											class="focus-visible:after:ring-border-default/50 flex w-full min-w-0 items-center gap-2 text-left outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-inset"
											onclick={() => onSelect(job)}
										>
											<span class="text-fg-default min-w-0 truncate text-sm font-medium">
												{job.name}
											</span>
											{#if job.builtin !== null}
												<Badge class={['shrink-0 whitespace-nowrap', NARROW.badge]}>Built-in</Badge>
											{/if}
										</Button>
									</td>
									<td class={cell}>
										<div class="relative z-[1] flex min-w-0">
											<LabTriggerButton
												{setup}
												jobName={job.name}
												size="xs"
												onchange={(next) => onsetup(job, next)}
											/>
										</div>
									</td>
									<td class={cell}>
										{#if labIsManual(setup)}
											<span class="text-fg-tertiary text-3xs pl-1.5">Manual</span>
										{:else}
											<div class="relative z-[1] flex">
												<LabChoiceMenu
													value={setup.mode}
													options={LAB_RUN_MODES}
													ariaLabel={`How ${job.name} runs`}
													size="xs"
													onchange={(mode) => onsetup(job, { ...setup, mode })}
												/>
											</div>
										{/if}
									</td>
									<td class={[cell, NARROW.where]}>
										{#if automatic}
											<span class="text-fg-tertiary text-2xs">-</span>
										{:else}
											<span class="text-fg-secondary text-2xs block truncate">
												{RUNS_IN_SHORT[setup.runsIn ?? job.runsIn]}
												<span class="text-fg-tertiary">→</span>
												{OUTPUT_SHORT[setup.output ?? job.output]}
											</span>
										{/if}
									</td>
									<td class={[cell, NARROW.last]}>
										{#if last}
											{@const look = JOB_RUN_STATUS[last.status]}
											<span
												class="text-fg-secondary text-2xs flex items-center gap-1.5 whitespace-nowrap tabular-nums"
											>
												<Icon
													name={look.icon}
													size={12}
													class={['shrink-0', look.tone]}
													ariaLabel={look.label}
												/>
												{jobRunTime(last, nowMs)}
											</span>
										{:else}
											<span class="text-fg-tertiary text-2xs">Never</span>
										{/if}
									</td>
									<td class={[cell, NARROW.month]}>
										{#if month.count > 0}
											{@const rate = successRate(month)}
											<div class="flex flex-col gap-1">
												<span class="text-fg-secondary text-2xs whitespace-nowrap tabular-nums">
													{month.count}
													{month.count === 1 ? 'run' : 'runs'}
													{#if rate !== null}
														<span class="text-fg-tertiary">· {rate}%</span>
													{/if}
												</span>
												<span
													class="bg-surface-150 flex h-1 w-16 gap-px overflow-hidden rounded-full"
													aria-hidden="true"
												>
													{#if month.succeeded > 0}
														<span
															class="bg-success-content basis-0"
															style:flex-grow={month.succeeded}
														></span>
													{/if}
													{#if month.failed > 0}
														<span
															class="bg-error-content basis-0"
															style:flex-grow={month.failed}
														></span>
													{/if}
												</span>
											</div>
										{:else}
											<span class="text-fg-tertiary text-2xs">No runs</span>
										{/if}
									</td>
									<td class={[cell, 'rounded-r-lg pr-3']}>
										{#if !automatic}
											<div
												class={[
													'relative z-[1] flex justify-end',
													!current &&
														'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100',
												]}
											>
												<Tooltip content="Run now" placement="left">
													<IconButton variant="ghost" size="sm" ariaLabel={`Run ${job.name}`}>
														<Icon name="play" size={12} />
													</IconButton>
												</Tooltip>
											</div>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
					{#if visible.length === 0}
						<p class="text-fg-tertiary py-10 text-center text-xs">No jobs match.</p>
					{/if}
				</div>
			</ScrollableDiv>

			{#if selected}
				{@const setup = setupOf(selected)}
				<aside
					id={PANEL_ID}
					class="border-border-default flex w-96 shrink-0 flex-col border-l-[0.5px]"
					aria-labelledby="lab-table-panel-heading"
				>
					<ScrollableDiv class="min-h-0 flex-1" ariaLabel="Job details">
						<div class="flex flex-col gap-7 px-5 pt-1 pb-10">
							<header class="flex items-start gap-2">
								<div class="min-w-0 flex-1">
									<div class="flex min-w-0 items-center gap-2">
										<h2
											id="lab-table-panel-heading"
											class="text-fg-default truncate text-base font-semibold tracking-tight"
										>
											{selected.name}
										</h2>
										{#if selected.builtin !== null}
											<Badge class="shrink-0 whitespace-nowrap">Built-in</Badge>
										{/if}
									</div>
									<p class="text-fg-secondary mt-1.5 text-xs leading-5">
										{labSentence(selected, setup)}
									</p>
								</div>
								<Tooltip content="Close" placement="left">
									<IconButton
										variant="ghost"
										size="sm"
										ariaLabel="Close details"
										onclick={() => (selectedId = null)}
									>
										<Icon name="close" size={13} />
									</IconButton>
								</Tooltip>
							</header>

							{#if !labIsManual(setup)}
								<section
									class="flex flex-col items-start gap-2"
									aria-labelledby="lab-table-mode-heading"
								>
									<h3 id="lab-table-mode-heading" class="text-fg-default text-sm font-medium">
										How it runs
									</h3>
									<LabRunsMode
										value={setup.mode}
										label={`How ${selected.name} runs`}
										onchange={(mode) => onsetup(selected, { ...setup, mode })}
									/>
									<p class="text-fg-tertiary text-xs">{modeHint(setup.mode)}</p>
								</section>
							{/if}

							<JobRecentRuns definitionId={selected.id} />

							<section class="flex flex-col gap-2" aria-labelledby="lab-table-instructions-heading">
								<div class="flex items-center gap-2">
									<h3
										id="lab-table-instructions-heading"
										class="text-fg-default flex-1 text-sm font-medium"
									>
										Instructions
									</h3>
									<Button variant="ghost" size="sm" onclick={() => (editing = !editing)}>
										{editing ? 'Done' : 'Edit'}
									</Button>
								</div>
								{#if editing}
									<JobEditor definition={selected} />
								{:else}
									<p class="text-fg-secondary line-clamp-4 text-xs leading-5">
										{instructionsPreview(selected.instructions)}
									</p>
								{/if}
							</section>
						</div>
					</ScrollableDiv>
				</aside>
			{/if}
		</div>
	</div>
</div>
