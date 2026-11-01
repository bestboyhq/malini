<script lang="ts">
	import type { JobDefinitionRecord } from '$contract/jobs';
	import { Switch } from '$hyper-ui/components/switch';
	import { Well } from '$hyper-ui/components/well';
	import {
		loadActivityCommand,
		showEveryChatTurnCommand,
	} from '$lib/jobs/application/commands/load-activity.command';
	import { agentActionsQuery } from '$lib/jobs/application/queries/agent-actions.query.svelte';
	import { chatTurnsQuery } from '$lib/jobs/application/queries/chat-turns.query.svelte';
	import { jobRunsForDefinitionQuery } from '$lib/jobs/application/queries/job-runs-for-definition.query.svelte';
	import { reconcilerDecisionsQuery } from '$lib/jobs/application/queries/reconciler-decisions.query.svelte';
	import {
		activityEntries,
		activityEntryRunning,
		type ActivityEntry,
	} from '$lib/jobs/domain/activity';
	import { isFinishedJobRunStatus, jobRunLastActivityAt } from '$lib/jobs/domain/job-run';
	import JobRunRow from '../JobRunRow.svelte';
	import ActivityRun from './ActivityRun.svelte';
	import AgentActionRow from './AgentActionRow.svelte';
	import { PageSection } from '$hyper-ui/components/page-section';
	import ChatTurnRow from './ChatTurnRow.svelte';
	import DecisionRow from './DecisionRow.svelte';

	interface Props {
		jobs: readonly JobDefinitionRecord[];
	}

	let { jobs }: Props = $props();

	const RECENT_LIMIT = 60;
	const ROWS =
		'border-surface-50-border bg-surface-50 divide-surface-50-border divide-y-[0.5px] rounded-xl border-[0.5px]';
	const DAY_MS = 24 * 60 * 60 * 1_000;
	const everyId = $props.id();

	let nowMs = $state(Date.now());

	const runsFor = $derived(jobRunsForDefinitionQuery.data);
	const runs = $derived(
		jobs
			.flatMap((job) => runsFor(job.id))
			.sort((left, right) => jobRunLastActivityAt(right).localeCompare(jobRunLastActivityAt(left))),
	);
	const entries = $derived(
		activityEntries(
			runs,
			chatTurnsQuery.data,
			agentActionsQuery.data,
			reconcilerDecisionsQuery.data,
		),
	);
	const running = $derived(entries.filter(activityEntryRunning));
	const days = $derived(groupByDay(entries.filter(finished).slice(0, RECENT_LIMIT)));

	$effect(() => {
		loadActivityCommand();
	});

	$effect(() => {
		const clock = setInterval(() => (nowMs = Date.now()), running.length > 0 ? 1_000 : 30_000);
		return () => clearInterval(clock);
	});

	function finished(entry: ActivityEntry): boolean {
		if (entry.kind === 'job') return isFinishedJobRunStatus(entry.run.status);
		return !activityEntryRunning(entry);
	}

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
		list: readonly ActivityEntry[],
	): readonly Readonly<{ label: string; entries: ActivityEntry[] }>[] {
		const groups: { label: string; entries: ActivityEntry[] }[] = [];
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

	function dayNote(list: readonly ActivityEntry[]): string {
		const of = (kind: ActivityEntry['kind']): number =>
			list.filter((entry) => entry.kind === kind).length;
		return [
			counted(of('job'), 'job run', 'job runs'),
			counted(of('chat'), 'chat turn', 'chat turns'),
			counted(of('call'), 'call', 'calls'),
			counted(of('decision'), 'event', 'events'),
		]
			.filter(Boolean)
			.join(' · ');
	}
</script>

{#snippet entryRow(entry: ActivityEntry)}
	{#if entry.kind === 'job'}
		<ActivityRun calls={entry.calls} {nowMs} subject={entry.run.title}>
			{#snippet row(trailing)}
				<JobRunRow
					run={entry.run}
					{nowMs}
					kind="Job"
					origin={entry.startedBy ? 'Started by an agent' : null}
					{trailing}
				/>
			{/snippet}
		</ActivityRun>
	{:else if entry.kind === 'chat'}
		<ActivityRun calls={entry.calls} {nowMs} subject={entry.turn.prompt}>
			{#snippet row(trailing)}
				<ChatTurnRow turn={entry.turn} {nowMs} {trailing} />
			{/snippet}
		</ActivityRun>
	{:else if entry.kind === 'decision'}
		<DecisionRow decision={entry.decision} {nowMs} />
	{:else}
		<AgentActionRow action={entry.action} {nowMs} kind="Call" />
	{/if}
{/snippet}

<PageSection
	title="Activity"
	description="What your jobs and chats did in Malini."
	testId="automations-activity"
>
	{#snippet actions()}
		<div class="flex shrink-0 items-center gap-2">
			<span id={everyId} class="text-fg-secondary text-xs">Every chat turn</span>
			<Switch
				checked={chatTurnsQuery.every}
				labelledBy={everyId}
				onchange={showEveryChatTurnCommand}
			/>
		</div>
	{/snippet}

	{#if running.length > 0}
		<Well title="Running now" note={`${running.length}`}>
			<ul class={[ROWS, 'flex flex-col p-1']}>
				{#each running as entry (`${entry.kind}:${entry.id}`)}
					<li>{@render entryRow(entry)}</li>
				{/each}
			</ul>
		</Well>
	{/if}

	{#each days as day (day.label)}
		<Well title={day.label} note={dayNote(day.entries)}>
			<ul class={[ROWS, 'flex flex-col p-1']}>
				{#each day.entries as entry (`${entry.kind}:${entry.id}`)}
					<li>{@render entryRow(entry)}</li>
				{/each}
			</ul>
		</Well>
	{/each}
</PageSection>
