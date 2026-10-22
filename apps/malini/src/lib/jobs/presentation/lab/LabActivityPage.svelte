<script lang="ts">
	import type { JobDefinitionRecord, JobRunRecord } from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { Icon } from '$hyper-ui/icons';
	import { jobRunsForDefinitionQuery } from '$lib/jobs/application/queries/job-runs-for-definition.query.svelte';
	import { jobRunLastActivityAt } from '$lib/jobs/domain/job-run';
	import JobRunRow from '../JobRunRow.svelte';
	import { labWaitingJobs } from './lab-activity';
	import { labState } from './lab-state.svelte';
	import { labTrigger } from './lab-triggers';

	interface Props {
		jobs: readonly JobDefinitionRecord[];
	}

	let { jobs }: Props = $props();

	const RECENT_LIMIT = 60;
	const DAY_MS = 24 * 60 * 60 * 1_000;

	let nowMs = $state(Date.now());

	const runsFor = $derived(jobRunsForDefinitionQuery.data);
	const runs = $derived(
		jobs
			.flatMap((job) => runsFor(job.id))
			.sort((left, right) => jobRunLastActivityAt(right).localeCompare(jobRunLastActivityAt(left))),
	);
	const needsYou = $derived(runs.filter((run) => run.status === 'needs-you'));
	const running = $derived(
		runs.filter((run) => run.status === 'running' || run.status === 'queued'),
	);
	const asking = $derived(labWaitingJobs(jobs, labState.setupOf, labState.dismissed));
	const days = $derived(
		groupByDay(
			runs
				.filter((run) => !['needs-you', 'running', 'queued'].includes(run.status))
				.slice(0, RECENT_LIMIT),
		),
	);

	$effect(() => {
		const clock = setInterval(() => (nowMs = Date.now()), running.length > 0 ? 1_000 : 30_000);
		return () => clearInterval(clock);
	});

	function dayLabel(iso: string): string {
		const start = new Date();
		start.setHours(0, 0, 0, 0);
		const at = Date.parse(iso);
		if (at >= start.getTime()) return 'Today';
		if (at >= start.getTime() - DAY_MS) return 'Yesterday';
		return new Date(at).toLocaleDateString(undefined, {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
		});
	}

	function groupByDay(
		list: readonly JobRunRecord[],
	): readonly Readonly<{ label: string; runs: JobRunRecord[] }>[] {
		const groups: { label: string; runs: JobRunRecord[] }[] = [];
		for (const run of list) {
			const label = dayLabel(jobRunLastActivityAt(run));
			const last = groups.at(-1);
			if (last?.label === label) last.runs.push(run);
			else groups.push({ label, runs: [run] });
		}
		return groups;
	}

	function onDismiss(job: JobDefinitionRecord): void {
		labState.dismissed = [...labState.dismissed, job.id];
	}
</script>

{#snippet heading(label: string, count: number)}
	<h2 class="text-fg-tertiary flex items-center gap-1.5 text-xs font-medium">
		{label}
		{#if count > 0}
			<span class="tabular-nums">{count}</span>
		{/if}
	</h2>
{/snippet}

<ScrollableDiv class="min-h-0 flex-1" ariaLabel="Activity">
	<div
		class="mx-auto flex w-full max-w-[760px] flex-col gap-8 px-10 pt-12 pb-16"
		data-testid="lab-activity-page"
	>
		<header>
			<h1 class="text-fg-default text-2xl font-semibold tracking-tight">Activity</h1>
			<p class="text-fg-tertiary mt-1 text-sm">What your jobs did, and what waits for you.</p>
		</header>

		<section class="flex flex-col gap-2" aria-label="Waiting for you">
			{@render heading('Waiting for you', needsYou.length + asking.length)}
			{#if needsYou.length + asking.length === 0}
				<p class="text-fg-tertiary text-xs">Nothing waits for you.</p>
			{/if}
			{#each asking as job (job.id)}
				<article
					class="border-warning-content/20 bg-warning flex items-center gap-3 rounded-xl border-[0.5px] px-4 py-3"
					aria-label={`${job.name} wants to run`}
				>
					<span class="text-warning-content shrink-0">
						<Icon name={labTrigger(labState.setupOf(job)).icon} size={14} />
					</span>
					<p class="min-w-0 flex-1 truncate text-sm">
						<span class="text-fg-default font-medium">{job.name} wants to run</span>
						<span class="text-fg-tertiary">· {labTrigger(labState.setupOf(job)).label}</span>
						<span class="text-warning-content text-2xs ml-1 font-medium">Preview</span>
					</p>
					<Button variant="ghost" size="sm" onclick={() => onDismiss(job)}>Skip</Button>
					<Button variant="primary" size="sm" onclick={() => onDismiss(job)}>Run it</Button>
				</article>
			{/each}
			{#if needsYou.length > 0}
				<ul class="-mx-2 flex flex-col">
					{#each needsYou as run (run.id)}
						<li><JobRunRow {run} {nowMs} /></li>
					{/each}
				</ul>
			{/if}
		</section>

		{#if running.length > 0}
			<section class="flex flex-col gap-2" aria-label="Running now">
				{@render heading('Running now', running.length)}
				<ul class="-mx-2 flex flex-col">
					{#each running as run (run.id)}
						<li><JobRunRow {run} {nowMs} /></li>
					{/each}
				</ul>
			</section>
		{/if}

		{#each days as day (day.label)}
			<section class="flex flex-col gap-2" aria-label={day.label}>
				{@render heading(day.label, day.runs.length)}
				<ul class="-mx-2 flex flex-col">
					{#each day.runs as run (run.id)}
						<li><JobRunRow {run} {nowMs} /></li>
					{/each}
				</ul>
			</section>
		{/each}
	</div>
</ScrollableDiv>
