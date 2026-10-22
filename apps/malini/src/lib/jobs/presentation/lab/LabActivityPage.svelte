<script lang="ts">
	import type { JobDefinitionRecord, JobRunRecord } from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { Well } from '$hyper-ui/components/well';
	import { Icon } from '$hyper-ui/icons';
	import { jobRunsForDefinitionQuery } from '$lib/jobs/application/queries/job-runs-for-definition.query.svelte';
	import { jobRunLastActivityAt } from '$lib/jobs/domain/job-run';
	import JobRunRow from '../JobRunRow.svelte';
	import { labWaitingJobs } from './lab-activity';
	import { labState } from './lab-state.svelte';
	import { labTrigger } from './lab-triggers';
	import LabSection from './LabSection.svelte';

	interface Props {
		jobs: readonly JobDefinitionRecord[];
	}

	let { jobs }: Props = $props();

	const RECENT_LIMIT = 60;
	const ROWS =
		'border-surface-50-border bg-surface-50 divide-surface-50-border divide-y-[0.5px] rounded-xl border-[0.5px]';
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

<LabSection
	title="Activity"
	description="What your jobs did, and what waits for you."
	testId="lab-activity-page"
>
	<Well
		title="Waiting for you"
		note={needsYou.length + asking.length > 0 ? `${needsYou.length + asking.length}` : undefined}
	>
		<div class={ROWS}>
			{#if needsYou.length + asking.length === 0}
				<p class="text-fg-tertiary px-4 py-3 text-xs">Nothing waits for you.</p>
			{/if}
			{#each asking as job (job.id)}
				<div class="flex items-center gap-3 px-4 py-3" aria-label={`${job.name} wants to run`}>
					<span
						class="bg-warning text-warning-content grid size-7 shrink-0 place-items-center rounded-md"
					>
						<Icon name={labTrigger(labState.setupOf(job)).icon} size={14} />
					</span>
					<div class="min-w-0 flex-1">
						<h3 class="text-fg-default truncate text-sm font-medium">{job.name} wants to run</h3>
						<p class="text-fg-tertiary truncate text-xs">
							{labTrigger(labState.setupOf(job)).label} · Preview
						</p>
					</div>
					<Button variant="ghost" size="sm" onclick={() => onDismiss(job)}>Skip</Button>
					<Button variant="primary" size="sm" onclick={() => onDismiss(job)}>Run it</Button>
				</div>
			{/each}
			{#if needsYou.length > 0}
				<ul class="flex flex-col p-1">
					{#each needsYou as run (run.id)}
						<li><JobRunRow {run} {nowMs} /></li>
					{/each}
				</ul>
			{/if}
		</div>
	</Well>

	{#if running.length > 0}
		<Well title="Running now" note={`${running.length}`}>
			<ul class={[ROWS, 'flex flex-col p-1']}>
				{#each running as run (run.id)}
					<li><JobRunRow {run} {nowMs} /></li>
				{/each}
			</ul>
		</Well>
	{/if}

	{#each days as day (day.label)}
		<Well title={day.label} note={`${day.runs.length} ${day.runs.length === 1 ? 'run' : 'runs'}`}>
			<ul class={[ROWS, 'flex flex-col p-1']}>
				{#each day.runs as run (run.id)}
					<li><JobRunRow {run} {nowMs} /></li>
				{/each}
			</ul>
		</Well>
	{/each}
</LabSection>
