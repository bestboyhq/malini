<script lang="ts">
	import { schedulePlaceName } from '$contract/automation-trigger';
	import { Button } from '$hyper-ui/components/button';
	import { Icon } from '$hyper-ui/icons';
	import { jobHref } from '$shared/router/routes-hrefs';
	import type { UpcomingScheduledJob } from '$lib/jobs/application/queries/upcoming-scheduled-jobs.query.svelte';
	import { upcomingTime } from './job-run-time';

	interface Props {
		jobs: readonly UpcomingScheduledJob[];
		nowMs: number;
	}

	let { jobs, nowMs }: Props = $props();
</script>

{#if jobs.length > 0}
	<p class="text-fg-tertiary flex h-7 items-center px-2 text-xs" aria-hidden="true">Upcoming</p>
	<ul aria-label="Upcoming jobs">
		{#each jobs as { definition, mode, schedule, nextAt } (definition.id)}
			{@const next = upcomingTime(nextAt, nowMs)}
			{@const subject = [
				definition.name,
				mode === 'ask' ? 'Asks first' : null,
				schedulePlaceName(schedule.place),
			]
				.filter(Boolean)
				.join(' · ')}
			<li>
				<Button
					bare
					href={jobHref(definition.id)}
					ariaLabel={`Open ${subject}, next run ${next.day} ${next.time}`}
					class="hover:bg-surface-50-hover focus-visible:ring-border-default/50 flex h-7 w-full min-w-0 cursor-pointer items-center gap-2 rounded-xl pr-1 pl-2 text-left text-xs outline-none focus-visible:ring-2"
				>
					<span class="text-fg-tertiary grid size-4 shrink-0 place-items-center" aria-hidden="true">
						<Icon name="clock" size={13} />
					</span>
					<span class="min-w-0 flex-1 truncate">
						<span class="text-fg-default font-medium">{definition.name}</span>
						{#if mode === 'ask'}
							<span class="text-fg-tertiary">· Asks first</span>
						{/if}
						<span class="text-fg-tertiary">· {schedulePlaceName(schedule.place)}</span>
					</span>
					<span class="text-fg-tertiary text-2xs shrink-0 pr-1 tabular-nums">
						{next.day}
						{next.time}
					</span>
				</Button>
			</li>
		{/each}
	</ul>
{/if}
