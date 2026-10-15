<script lang="ts">
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Icon } from '$hyper-ui/icons';
	import { RepositoryAvatar } from '$shared/repositories/repositories.api';
	import { dayStreak, runsOn } from '$lib/stats/domain/activity';
	import { activityStatsQuery } from '$lib/stats/application/queries/activity-stats.query.svelte';
	import { latestResourceSampleQuery } from '$lib/stats/application/queries/latest-resource-sample.query.svelte';
	import { machineMemoryQuery } from '$lib/stats/application/queries/machine-memory.query.svelte';
	import { resourceHistoryQuery } from '$lib/stats/application/queries/resource-history.query.svelte';
	import ActivityHeatmap from './ActivityHeatmap.svelte';
	import MemoryChart from './MemoryChart.svelte';
	import StatsBar from './StatsBar.svelte';
	import { resourceKindDisplay } from './resource-kinds';
	import { formatAgentTime, formatCount, formatCpu, formatMemory, plural } from './stats-format';

	const TOP_REPOSITORIES = 3;

	const activity = $derived(activityStatsQuery.data);
	const latest = $derived(latestResourceSampleQuery.data);
	const history = $derived(resourceHistoryQuery.data);
	const machineMemory = $derived(machineMemoryQuery.data);

	const usage = $derived(
		[...(latest?.usage ?? [])].sort((left, right) => right.memoryBytes - left.memoryBytes),
	);
	const heaviest = $derived(Math.max(1, ...usage.map((entry) => entry.memoryBytes)));
	const repositories = $derived(activity?.repositories.slice(0, TOP_REPOSITORIES) ?? []);
	const busiestRepository = $derived(Math.max(1, ...repositories.map((entry) => entry.runs)));
	const tiles = $derived(
		activity
			? [
					tile(activity.runningAgents, 'agent', 'agents', 'Running now'),
					tile(runsOn(activity.days, activity.today), 'run', 'runs', 'Today'),
					tile(dayStreak(activity.days, activity.today), 'day', 'days', 'Streak'),
				]
			: [],
	);

	function tile(
		count: number,
		one: string,
		many: string,
		label: string,
	): { value: string; unit: string; label: string } {
		return { value: formatCount(count), unit: count === 1 ? one : many, label };
	}
</script>

<div class="flex flex-col gap-2.5">
	<section
		class="border-surface-elevated-border rounded-xl border-[0.5px] p-3"
		aria-label="Right now"
	>
		<div class="flex items-baseline justify-between gap-3">
			<h3 class="text-fg-secondary text-xs font-medium">Right now</h3>
			{#if latest}
				<span class="text-fg-tertiary text-xs tabular-nums">
					{plural(latest.processes, 'process', 'processes')}
				</span>
			{/if}
		</div>
		{#if latest}
			<div class="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-4">
				<div>
					<p
						class="text-fg-default text-3xl leading-9 font-semibold tabular-nums"
						data-testid="stats-memory-now"
					>
						{formatMemory(latest.memoryBytes)}
					</p>
					<p class="text-fg-tertiary text-xs">
						memory{machineMemory > 0 ? ` of ${formatMemory(machineMemory)}` : ''}
					</p>
				</div>
				<MemoryChart samples={history} />
				<div class="text-right">
					<p
						class="text-fg-default text-3xl leading-9 font-semibold tabular-nums"
						data-testid="stats-cpu-now"
					>
						{formatCpu(latest.cpuPercent)}
					</p>
					<p class="text-fg-tertiary text-xs">CPU</p>
				</div>
			</div>
			<ul class="mt-3 space-y-2" aria-label="Memory by kind" data-testid="stats-resource-usage">
				{#each usage as entry (entry.kind)}
					{@const display = resourceKindDisplay(entry.kind)}
					<StatsBar
						value={formatMemory(entry.memoryBytes)}
						share={entry.memoryBytes / heaviest}
						testId="stats-resource-row"
					>
						{#snippet lead()}
							<Icon name={display.icon} size={14} class="text-fg-tertiary shrink-0" />
						{/snippet}
						{display.label}
					</StatsBar>
				{/each}
			</ul>
		{:else}
			<p class="text-fg-tertiary mt-2 text-xs">Measuring malini…</p>
		{/if}
	</section>

	{#if activity}
		<section class="flex flex-col gap-2.5" aria-label="Activity">
			<div class="flex items-end justify-between gap-3 px-1">
				<div>
					<p
						class="text-fg-default text-3xl leading-9 font-semibold tabular-nums"
						data-testid="stats-runs-total"
					>
						{formatCount(activity.runs)}
					</p>
					<p class="text-fg-tertiary text-xs">agent runs</p>
				</div>
				<div class="text-right">
					<p
						class="text-fg-default text-3xl leading-9 font-semibold tabular-nums"
						data-testid="stats-agent-time"
					>
						{formatAgentTime(activity.agentSeconds)}
					</p>
					<p class="text-fg-tertiary text-xs">agents at work</p>
				</div>
			</div>

			<ul class="grid grid-cols-3 gap-2" aria-label="Activity at a glance">
				{#each tiles as tile (tile.label)}
					<li class="border-surface-elevated-border rounded-xl border-[0.5px] px-3 py-2.5">
						<p class="text-fg-default text-xl leading-7 font-semibold tabular-nums">
							{tile.value}
							<span class="text-fg-tertiary text-xs font-normal">{tile.unit}</span>
						</p>
						<p class="text-fg-tertiary text-xs">{tile.label}</p>
					</li>
				{/each}
			</ul>

			<div class="border-surface-elevated-border rounded-xl border-[0.5px] p-3">
				<ActivityHeatmap days={activity.days} today={activity.today} />
			</div>

			{#if repositories.length > 0}
				<div class="border-surface-elevated-border rounded-xl border-[0.5px] p-3">
					<h3 class="text-fg-secondary text-xs font-medium">Where you work</h3>
					<ul class="mt-2.5 space-y-2" aria-label="Runs by repository">
						{#each repositories as repository (repository.fullName)}
							<StatsBar
								value={formatCount(repository.runs)}
								share={repository.runs / busiestRepository}
								testId="stats-repository-row"
							>
								{#snippet lead()}
									<RepositoryAvatar fullName={repository.fullName} size={16} />
								{/snippet}
								<SensitiveText text={repository.fullName} />
							</StatsBar>
						{/each}
					</ul>
				</div>
			{/if}

			<p class="text-fg-tertiary px-1 text-xs">
				{plural(activity.jobRuns, 'run', 'runs')} from jobs · Counted on this Mac only
			</p>
		</section>
	{/if}
</div>
