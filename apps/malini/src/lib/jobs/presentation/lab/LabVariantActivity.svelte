<script lang="ts">
	import type { Snippet } from 'svelte';
	import {
		isAutomaticJobBuiltin,
		type JobDefinitionRecord,
		type JobRunRecord,
		type JobRunStatus,
	} from '$contract/jobs';
	import { Badge } from '$hyper-ui/components/badge';
	import { Button } from '$hyper-ui/components/button';
	import { EmptyState } from '$hyper-ui/components/empty-state';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { Sheet } from '$hyper-ui/components/sheet';
	import { Icon, type IconName } from '$hyper-ui/icons';
	import { jobRunsForDefinitionQuery } from '$lib/jobs/application/queries/job-runs-for-definition.query.svelte';
	import { JOB_OUTPUT_OPTIONS, JOB_RUNS_IN_OPTIONS } from '../job-definition-copy';
	import JobEditor from '../JobEditor.svelte';
	import JobRunRow from '../JobRunRow.svelte';
	import {
		LAB_RUN_MODES,
		labIsManual,
		labSentence,
		labTrigger,
		type LabJobSetup,
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

	const EARLIER_LIMIT = 60;
	const LIVE_STATUSES: readonly JobRunStatus[] = ['needs-you', 'queued', 'running'];
	const DAY_FORMAT = new Intl.DateTimeFormat(undefined, {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
	});

	type Day = { label: string; runs: JobRunRecord[] };

	let filterId = $state<string | null>(null);
	let sheet = $state<'setup' | 'new' | null>(null);
	let dismissed = $state<readonly string[]>([]);
	let nowMs = $state(Date.now());

	const runsFor = $derived(jobRunsForDefinitionQuery.data);
	const active = $derived(jobs.find((job) => job.id === filterId) ?? null);
	const activeSetup = $derived(active ? setupOf(active) : null);
	const shown = $derived(active ? [active] : jobs);
	const runs = $derived(
		shown
			.flatMap((job) => runsFor(job.id))
			.sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
	);
	const waiting = $derived(runs.filter((run) => run.status === 'needs-you'));
	const running = $derived(
		runs.filter((run) => run.status === 'queued' || run.status === 'running'),
	);
	const finished = $derived(runs.filter((run) => !LIVE_STATUSES.includes(run.status)));
	const asking = $derived(
		shown.filter((job) => {
			const setup = setupOf(job);
			return setup.mode === 'ask' && !labIsManual(setup) && !dismissed.includes(job.id);
		}),
	);
	const days = $derived.by(() => {
		const groups: Day[] = [];
		for (const run of finished.slice(0, EARLIER_LIMIT)) {
			const label = dayLabel(run);
			const current = groups.at(-1);
			if (current?.label === label) current.runs.push(run);
			else groups.push({ label, runs: [run] });
		}
		return groups;
	});
	const totalRuns = $derived(jobs.reduce((total, job) => total + runsFor(job.id).length, 0));

	$effect(() => {
		const clock = setInterval(() => (nowMs = Date.now()), running.length > 0 ? 1_000 : 30_000);
		return () => clearInterval(clock);
	});

	function startOfDay(ms: number, daysBack = 0): number {
		const day = new Date(ms);
		day.setHours(0, 0, 0, 0);
		day.setDate(day.getDate() - daysBack);
		return day.getTime();
	}

	function dayLabel(run: JobRunRecord): string {
		const day = startOfDay(Date.parse(run.createdAt));
		if (day === startOfDay(nowMs)) return 'Today';
		if (day === startOfDay(nowMs, 1)) return 'Yesterday';
		return DAY_FORMAT.format(day);
	}

	function modeHint(setup: LabJobSetup): string {
		return LAB_RUN_MODES.find((option) => option.value === setup.mode)?.hint ?? '';
	}

	function update(job: JobDefinitionRecord, next: LabJobSetup): void {
		onsetup(job, next);
		dismissed = dismissed.filter((id) => id !== job.id);
	}

	function dismiss(job: JobDefinitionRecord): void {
		dismissed = [...dismissed, job.id];
	}

	function waitingFor(job: JobDefinitionRecord): boolean {
		return runsFor(job.id).some((run) => run.status === 'needs-you');
	}
</script>

{#snippet filterRow(
	label: string,
	icon: IconName,
	count: number,
	selected: boolean,
	needsYou: boolean,
	onclick: () => void,
)}
	<li>
		<Button
			bare
			{...selected ? { ariaCurrent: 'page' as const } : {}}
			class={[
				'sidebar-row w-full gap-2 px-2 text-left',
				selected ? 'sidebar-row-active' : 'text-fg-secondary',
			]}
			{onclick}
		>
			<span class="text-fg-tertiary grid size-4 shrink-0 place-items-center">
				<Icon name={icon} size={13} />
			</span>
			<span class="text-fg-default min-w-0 flex-1 truncate">{label}</span>
			{#if needsYou}
				<span class="text-warning-content grid size-4 shrink-0 place-items-center">
					<Icon name="alert" size={12} />
				</span>
			{/if}
			{#if count > 0}
				<span class="text-fg-tertiary text-2xs shrink-0 tabular-nums">{count}</span>
			{/if}
		</Button>
	</li>
{/snippet}

{#snippet heading(id: string, label: string, count: number)}
	<h2 {id} class="text-fg-tertiary flex items-center gap-1.5 text-xs font-medium">
		{label}
		<span class="tabular-nums">{count}</span>
	</h2>
{/snippet}

{#snippet field(label: string, body: Snippet)}
	<div class="grid grid-cols-[56px_1fr] items-center gap-3 px-4 py-3">
		<span class="text-fg-tertiary text-xs font-medium">{label}</span>
		<div class="flex min-w-0 flex-wrap items-center gap-2">{@render body()}</div>
	</div>
{/snippet}

<div class="flex min-h-0 flex-1" data-testid="lab-activity">
	<nav class="flex w-60 shrink-0 flex-col" aria-label="Filter by job">
		<div class="px-3 pt-1 pb-3">
			<Button variant="secondary" size="sm" class="w-full" onclick={() => (sheet = 'new')}>
				{#snippet leading()}
					<Icon name="plus" size={14} />
				{/snippet}
				New job
			</Button>
		</div>
		<ScrollableDiv class="min-h-0 flex-1" ariaLabel="Jobs">
			<div class="flex flex-col gap-4 px-3 pb-6">
				<ul class="flex flex-col">
					{@render filterRow(
						'All jobs',
						'checklist',
						totalRuns,
						active === null,
						false,
						() => (filterId = null),
					)}
				</ul>
				<section aria-labelledby="lab-activity-jobs">
					<h2 id="lab-activity-jobs" class="text-fg-tertiary px-2 pb-1.5 text-xs font-medium">
						Jobs
					</h2>
					<ul class="flex flex-col gap-px">
						{#each jobs as job (job.id)}
							{@render filterRow(
								job.name,
								labTrigger(setupOf(job)).icon,
								runsFor(job.id).length,
								job.id === active?.id,
								waitingFor(job),
								() => (filterId = job.id),
							)}
						{/each}
					</ul>
				</section>
			</div>
		</ScrollableDiv>
	</nav>

	<ScrollableDiv class="min-w-0 flex-1" ariaLabel="Activity">
		<div class="mx-auto flex w-full max-w-[760px] flex-col gap-8 px-8 pt-1 pb-16">
			{#if active && activeSetup}
				<section
					class="border-surface-50-border bg-surface-50 flex items-start gap-3 rounded-2xl border-[0.5px] px-4 py-3.5"
					aria-labelledby="lab-activity-job"
				>
					<span
						class="border-chip-border bg-chip text-fg-secondary grid size-8 shrink-0 place-items-center rounded-full border-[0.5px]"
					>
						<Icon name={labTrigger(activeSetup).icon} size={14} />
					</span>
					<div class="min-w-0 flex-1">
						<div class="flex min-w-0 items-center gap-2">
							<h2
								id="lab-activity-job"
								class="text-fg-default truncate text-base font-semibold tracking-tight"
							>
								{active.name}
							</h2>
							{#if active.builtin !== null}
								<Badge>Built-in</Badge>
							{/if}
						</div>
						<p class="text-fg-secondary mt-0.5 text-sm leading-6">
							{labSentence(active, activeSetup)}
						</p>
					</div>
					<Button variant="secondary" size="sm" onclick={() => (sheet = 'setup')}>
						{#snippet leading()}
							<Icon name="settings" size={13} />
						{/snippet}
						Set up
					</Button>
				</section>
			{/if}

			{#if waiting.length > 0 || asking.length > 0}
				<section class="flex flex-col gap-2" aria-labelledby="lab-activity-waiting">
					{@render heading(
						'lab-activity-waiting',
						'Waiting for you',
						waiting.length + asking.length,
					)}
					{#if asking.length > 0}
						<ul class="flex flex-col gap-2" aria-label="Asks to run">
							{#each asking as job (job.id)}
								{@const trigger = labTrigger(setupOf(job))}
								<li
									class="border-surface-50-border bg-surface-50 flex items-center gap-3 rounded-xl border-[0.5px] py-2.5 pr-2.5 pl-3"
								>
									<span
										class="bg-warning text-warning-content grid size-7 shrink-0 place-items-center rounded-full"
									>
										<Icon name={trigger.icon} size={13} />
									</span>
									<p class="min-w-0 flex-1 truncate text-sm">
										<span class="text-fg-default font-medium">{job.name} wants to run</span>
										<span class="text-fg-tertiary">· {trigger.label}</span>
										<span class="text-warning-content text-2xs ml-1 font-medium">Preview</span>
									</p>
									<Button variant="ghost" size="xs" onclick={() => dismiss(job)}>Skip</Button>
									<Button variant="primary" size="xs" onclick={() => dismiss(job)}>Run it</Button>
								</li>
							{/each}
						</ul>
					{/if}
					{#if waiting.length > 0}
						<ul
							class="border-surface-50-border bg-surface-50 flex flex-col rounded-xl border-[0.5px] p-1"
							aria-label="Runs that need you"
						>
							{#each waiting as run (run.id)}
								<li><JobRunRow {run} {nowMs} placeFirst={active !== null} /></li>
							{/each}
						</ul>
					{/if}
				</section>
			{/if}

			{#if running.length > 0}
				<section class="flex flex-col gap-2" aria-labelledby="lab-activity-running">
					{@render heading('lab-activity-running', 'Running now', running.length)}
					<ul class="-mx-2 flex flex-col">
						{#each running as run (run.id)}
							<li><JobRunRow {run} {nowMs} placeFirst={active !== null} /></li>
						{/each}
					</ul>
				</section>
			{/if}

			{#each days as day, index (day.label)}
				<section class="flex flex-col gap-2" aria-labelledby={`lab-activity-day-${index}`}>
					{@render heading(`lab-activity-day-${index}`, day.label, day.runs.length)}
					<ul class="-mx-2 flex flex-col">
						{#each day.runs as run (run.id)}
							<li><JobRunRow {run} {nowMs} placeFirst={active !== null} /></li>
						{/each}
					</ul>
				</section>
			{/each}

			{#if finished.length > EARLIER_LIMIT}
				<p class="text-fg-tertiary text-xs">Showing the latest {EARLIER_LIMIT} runs.</p>
			{/if}

			{#if runs.length === 0}
				<EmptyState
					title={active ? `${active.name} has not run yet` : 'No runs yet'}
					description="Runs show up here as they happen."
				>
					{#snippet icon()}
						<Icon name="clock" size={16} />
					{/snippet}
				</EmptyState>
			{/if}
		</div>
	</ScrollableDiv>
</div>

<Sheet
	open={sheet === 'new'}
	title="New job"
	description="Name it and tell the agent what to do."
	class="max-w-[720px]"
	onclose={() => (sheet = null)}
>
	<JobEditor definition={null} />
</Sheet>

{#if active && activeSetup}
	{@const automatic = isAutomaticJobBuiltin(active.builtin)}
	<Sheet
		open={sheet === 'setup'}
		title={active.name}
		description={labSentence(active, activeSetup)}
		class="max-w-[720px]"
		onclose={() => (sheet = null)}
	>
		<div class="flex flex-col gap-6">
			<section
				class="border-surface-50-border bg-surface-50 divide-surface-50-border divide-y-[0.5px] rounded-xl border-[0.5px]"
				aria-label="How it runs"
			>
				{#snippet whenBody()}
					<LabTriggerButton
						setup={activeSetup}
						jobName={active.name}
						onchange={(next) => update(active, next)}
					/>
				{/snippet}
				{@render field('When', whenBody)}

				{#if !labIsManual(activeSetup)}
					{#snippet modeBody()}
						<LabRunsMode
							value={activeSetup.mode}
							label={`How ${active.name} runs`}
							onchange={(mode) => update(active, { ...activeSetup, mode })}
						/>
						<span class="text-fg-tertiary text-xs">{modeHint(activeSetup)}</span>
					{/snippet}
					{@render field('Runs', modeBody)}
				{/if}

				{#if !automatic}
					{#snippet whereBody()}
						<LabChoiceMenu
							value={activeSetup.runsIn ?? active.runsIn}
							options={JOB_RUNS_IN_OPTIONS}
							ariaLabel="Runs in"
							icon="branch"
							onchange={(runsIn) => update(active, { ...activeSetup, runsIn })}
						/>
					{/snippet}
					{@render field('Where', whereBody)}

					{#snippet thenBody()}
						<LabChoiceMenu
							value={activeSetup.output ?? active.output}
							options={JOB_OUTPUT_OPTIONS}
							ariaLabel="When it finishes"
							icon="pr-draft"
							onchange={(output) => update(active, { ...activeSetup, output })}
						/>
					{/snippet}
					{@render field('Then', thenBody)}
				{/if}
			</section>

			<section class="flex flex-col gap-3" aria-labelledby="lab-activity-instructions">
				<h3 id="lab-activity-instructions" class="text-fg-default text-sm font-medium">
					What it does
				</h3>
				<JobEditor definition={active} />
			</section>
		</div>
	</Sheet>
{/if}
