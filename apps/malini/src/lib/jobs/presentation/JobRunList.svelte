<script lang="ts">
	import type { JobRunRecord } from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { Icon } from '$hyper-ui/icons';
	import JobRunRow from './JobRunRow.svelte';

	interface Props {
		active: readonly JobRunRecord[];
		finished: readonly JobRunRecord[];
		nowMs: number;
	}

	let { active, finished, nowMs }: Props = $props();

	let recentOpen = $state(false);

	const recentListId = $props.id();
</script>

{#if active.length > 0}
	<ul aria-label="Jobs in progress">
		{#each active as run (run.id)}
			<li><JobRunRow {run} {nowMs} /></li>
		{/each}
	</ul>
{/if}
{#if finished.length > 0}
	<Button
		bare
		ariaExpanded={recentOpen}
		ariaControls={recentListId}
		class="text-fg-tertiary hover:bg-surface-50-hover hover:text-fg-default focus-visible:ring-border-default/50 flex h-7 w-full cursor-pointer items-center gap-2 rounded-xl px-2 text-left text-xs outline-none focus-visible:ring-2"
		onclick={() => (recentOpen = !recentOpen)}
	>
		<span class="grid size-4 shrink-0 place-items-center" aria-hidden="true">
			<Icon
				name="chevron-right"
				size={12}
				class={[
					'transition-transform duration-150 motion-reduce:transition-none',
					recentOpen && 'rotate-90',
				]}
			/>
		</span>
		<span class="min-w-0 flex-1">Recent</span>
		<span class="text-2xs pr-1 tabular-nums">{finished.length}</span>
	</Button>
	{#if recentOpen}
		<ul id={recentListId} aria-label="Recent jobs">
			{#each finished as run (run.id)}
				<li><JobRunRow {run} {nowMs} /></li>
			{/each}
		</ul>
	{/if}
{/if}
