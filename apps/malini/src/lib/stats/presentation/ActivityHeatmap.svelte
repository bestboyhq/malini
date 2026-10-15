<script lang="ts">
	import type { ActivityDay } from '$contract/stats';
	import { activityCalendar, type ActivityLevel, type CalendarDay } from './activity-calendar';
	import { plural } from './stats-format';

	interface Props {
		days: readonly ActivityDay[];
		today: string;
	}

	let { days, today }: Props = $props();

	const WEEKS = 26;
	const LEVELS: readonly ActivityLevel[] = [0, 1, 2, 3, 4];
	const dayFormat = new Intl.DateTimeFormat(undefined, {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		timeZone: 'UTC',
	});

	const calendar = $derived(activityCalendar(days, today, WEEKS));
	const summary = $derived(`${plural(calendar.activeDays, 'day', 'days')} in the last 6 months`);

	let hovered: CalendarDay | null = $state(null);

	function levelClass(level: ActivityLevel): string {
		if (level === 4) return 'bg-activity-4';
		if (level === 3) return 'bg-activity-3';
		if (level === 2) return 'bg-activity-2';
		if (level === 1) return 'bg-activity-1';
		return 'bg-surface-elevated-selected';
	}

	function describe(day: CalendarDay): string {
		const date = dayFormat.format(new Date(`${day.date}T00:00:00Z`));
		return `${date} · ${plural(day.runs, 'run', 'runs')}`;
	}
</script>

<div class="flex items-center justify-between gap-3 text-xs">
	<p class="text-fg-secondary tabular-nums" aria-live="polite" data-testid="stats-heatmap-caption">
		{hovered ? describe(hovered) : summary}
	</p>
	<div class="text-fg-tertiary flex items-center gap-1" aria-hidden="true">
		<span class="mr-0.5">Less</span>
		{#each LEVELS as level (level)}
			<span class={['size-2.5 rounded-[3px]', levelClass(level)]}></span>
		{/each}
		<span class="ml-0.5">More</span>
	</div>
</div>

<div
	class="mt-3 grid gap-x-[3px]"
	style={`grid-template-columns: repeat(${WEEKS}, minmax(0, 1fr))`}
	role="img"
	aria-label={`Runs per day: ${summary}`}
	data-testid="stats-heatmap"
>
	{#each calendar.months as month (month.week)}
		<span
			class="text-fg-tertiary text-2xs col-span-3 row-start-1 mb-1.5 whitespace-nowrap"
			style={`grid-column-start: ${month.week + 1}`}
			aria-hidden="true"
		>
			{month.label}
		</span>
	{/each}
	{#each calendar.weeks as week, index (week[0]?.date ?? index)}
		<span class="row-start-2 grid gap-y-[3px]" style={`grid-column-start: ${index + 1}`}>
			{#each week as day (day.date)}
				<span
					class={['aspect-square rounded-[3px]', day.future ? 'invisible' : levelClass(day.level)]}
					aria-hidden="true"
					onpointerenter={() => (hovered = day.future ? null : day)}
					onpointerleave={() => (hovered = null)}
				></span>
			{/each}
		</span>
	{/each}
</div>
