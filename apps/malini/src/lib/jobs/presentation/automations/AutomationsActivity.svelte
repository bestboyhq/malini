<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { JobDefinitionRecord, JobRunRecord } from '$contract/jobs';
	import { Well } from '$hyper-ui/components/well';
	import { jobRunsForDefinitionQuery } from '$lib/jobs/application/queries/job-runs-for-definition.query.svelte';
	import { jobRunLastActivityAt } from '$lib/jobs/domain/job-run';
	import JobRunRow from '../JobRunRow.svelte';
	import AutomationsSection from './AutomationsSection.svelte';

	interface Props {
		jobs: readonly JobDefinitionRecord[];
		waitingCount: number;
		waiting: Snippet;
	}

	let { jobs, waitingCount, waiting }: Props = $props();

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
</script>

<AutomationsSection
	title="Activity"
	description="What your jobs did, and what waits for you."
	testId="automations-activity"
>
	<Well
		title="Waiting for you"
		note={needsYou.length + waitingCount > 0 ? `${needsYou.length + waitingCount}` : undefined}
	>
		<div class={ROWS}>
			{#if needsYou.length + waitingCount === 0}
				<p class="text-fg-tertiary px-4 py-3 text-xs">Nothing waits for you.</p>
			{/if}
			{@render waiting()}
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
</AutomationsSection>
