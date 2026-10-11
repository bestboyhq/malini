<script lang="ts">
	import type { JobRunRecord } from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { LoadingCircle } from '$hyper-ui/components/loading-circle';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import type { JobCenterCounts } from './job-center-summary';
	import JobRunList from './JobRunList.svelte';

	interface Props {
		active: readonly JobRunRecord[];
		finished: readonly JobRunRecord[];
		nowMs: number;
		counts: JobCenterCounts;
		summary: string;
	}

	let { active, finished, nowMs, counts, summary }: Props = $props();

	let expanded = $state(true);
</script>

<div
	class="border-surface-elevated-border bg-surface-elevated w-72 overflow-hidden rounded-xl border-[0.5px] shadow-lg"
	data-testid="job-center-docked"
>
	<div class="flex items-center gap-0.5 p-1">
		<Button
			bare
			ariaLabel={`Jobs: ${summary}`}
			ariaExpanded={expanded}
			ariaControls="job-center-docked-list"
			class="hover:bg-surface-elevated-hover focus-visible:ring-border-default/50 flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none focus-visible:ring-2"
			onclick={() => (expanded = !expanded)}
		>
			<span class="text-fg-secondary grid size-4 shrink-0 place-items-center" aria-hidden="true">
				{#if counts.running > 0}
					<LoadingCircle size={12} />
				{:else if counts.needsYou > 0}
					<Icon name="alert" size={13} class="text-warning-content" />
				{:else}
					<Icon name="checklist" size={13} />
				{/if}
			</span>
			<span class="min-w-0 flex-1 truncate" aria-hidden="true">
				<span class="text-fg-default font-medium">Jobs</span>
				<span class={counts.needsYou > 0 ? 'text-warning-content' : 'text-fg-tertiary'}>
					· {summary}
				</span>
			</span>
			<Icon
				name="chevron-down"
				size={13}
				class={[
					'text-fg-tertiary shrink-0 transition-transform duration-150 motion-reduce:transition-none',
					expanded ? '' : 'rotate-180',
				]}
			/>
		</Button>
		<Tooltip content="Manage jobs" placement="top">
			<IconButton variant="ghost" size="sm" href="/jobs" ariaLabel="Manage jobs">
				<Icon name="settings" size={13} />
			</IconButton>
		</Tooltip>
	</div>
	{#if expanded}
		<div
			id="job-center-docked-list"
			class="max-h-[var(--job-center-room)] overflow-y-auto px-1 pb-1"
		>
			<JobRunList {active} {finished} {nowMs} />
		</div>
	{/if}
</div>
