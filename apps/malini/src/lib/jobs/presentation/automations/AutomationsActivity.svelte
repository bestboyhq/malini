<script lang="ts">
	import type { AgentActionRecord, JobDefinitionRecord, JobRunRecord } from '$contract/jobs';
	import { Well } from '$hyper-ui/components/well';
	import { loadAgentActionsCommand } from '$lib/jobs/application/commands/load-agent-actions.command';
	import { agentActionsQuery } from '$lib/jobs/application/queries/agent-actions.query.svelte';
	import { jobRunsForDefinitionQuery } from '$lib/jobs/application/queries/job-runs-for-definition.query.svelte';
	import { isFinishedJobRunStatus, jobRunLastActivityAt } from '$lib/jobs/domain/job-run';
	import JobRunRow from '../JobRunRow.svelte';
	import AgentActionRow from './AgentActionRow.svelte';
	import AutomationsSection from './AutomationsSection.svelte';
	import WaitingJobRunRow from './WaitingJobRunRow.svelte';

	interface Props {
		jobs: readonly JobDefinitionRecord[];
	}

	type Entry =
		| Readonly<{ kind: 'run'; id: string; at: string; run: JobRunRecord }>
		| Readonly<{ kind: 'action'; id: string; at: string; action: AgentActionRecord }>;

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
	const actions = $derived(agentActionsQuery.data);
	const waiting = $derived(runs.filter((run) => run.status === 'waiting'));
	const needsYou = $derived(runs.filter((run) => run.status === 'needs-you'));
	const waitingForYou = $derived(waiting.length + needsYou.length);
	const running = $derived(
		runs.filter((run) => run.status === 'running' || run.status === 'queued'),
	);
	const runningActions = $derived(actions.filter((action) => action.status === 'running'));
	const days = $derived(
		groupByDay(
			[
				...runs
					.filter((run) => isFinishedJobRunStatus(run.status))
					.map((run): Entry => ({ kind: 'run', id: run.id, at: jobRunLastActivityAt(run), run })),
				...actions
					.filter((action) => action.status !== 'running')
					.map((action): Entry => ({
						kind: 'action',
						id: action.id,
						at: action.finishedAt ?? action.startedAt,
						action,
					})),
			]
				.sort((left, right) => right.at.localeCompare(left.at))
				.slice(0, RECENT_LIMIT),
		),
	);

	$effect(() => {
		loadAgentActionsCommand();
	});

	$effect(() => {
		const busy = running.length + runningActions.length > 0;
		const clock = setInterval(() => (nowMs = Date.now()), busy ? 1_000 : 30_000);
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
		list: readonly Entry[],
	): readonly Readonly<{ label: string; entries: Entry[] }>[] {
		const groups: { label: string; entries: Entry[] }[] = [];
		for (const entry of list) {
			const label = dayLabel(entry.at);
			const last = groups.at(-1);
			if (last?.label === label) last.entries.push(entry);
			else groups.push({ label, entries: [entry] });
		}
		return groups;
	}

	function counted(count: number, one: string, many: string): string | null {
		return count === 0 ? null : `${count} ${count === 1 ? one : many}`;
	}

	function dayNote(entries: readonly Entry[]): string {
		const calls = entries.filter((entry) => entry.kind === 'action').length;
		return [
			counted(entries.length - calls, 'run', 'runs'),
			counted(calls, 'tool call', 'tool calls'),
		]
			.filter(Boolean)
			.join(' · ');
	}
</script>

<AutomationsSection
	title="Activity"
	description="What your jobs and agents did in Malini, and what waits for you."
	testId="automations-activity"
>
	<Well title="Waiting for you" note={waitingForYou > 0 ? `${waitingForYou}` : undefined}>
		<div class={ROWS}>
			{#if waitingForYou === 0}
				<p class="text-fg-tertiary px-4 py-3 text-xs">Nothing waits for you.</p>
			{/if}
			{#each waiting as run (run.id)}
				<WaitingJobRunRow {run} {nowMs} />
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

	{#if running.length + runningActions.length > 0}
		<Well title="Running now" note={`${running.length + runningActions.length}`}>
			<ul class={[ROWS, 'flex flex-col p-1']}>
				{#each running as run (run.id)}
					<li><JobRunRow {run} {nowMs} /></li>
				{/each}
				{#each runningActions as action (action.id)}
					<li><AgentActionRow {action} {nowMs} /></li>
				{/each}
			</ul>
		</Well>
	{/if}

	{#each days as day (day.label)}
		<Well title={day.label} note={dayNote(day.entries)}>
			<ul class={[ROWS, 'flex flex-col p-1']}>
				{#each day.entries as entry (entry.id)}
					<li>
						{#if entry.kind === 'run'}
							<JobRunRow run={entry.run} {nowMs} />
						{:else}
							<AgentActionRow action={entry.action} {nowMs} />
						{/if}
					</li>
				{/each}
			</ul>
		</Well>
	{/each}
</AutomationsSection>
