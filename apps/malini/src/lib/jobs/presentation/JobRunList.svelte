<script lang="ts">
	import type { JobRunRecord } from '$contract/jobs';
	import JobRunRow from './JobRunRow.svelte';

	interface Props {
		active: readonly JobRunRecord[];
		finished: readonly JobRunRecord[];
		nowMs: number;
		onopen?: (() => void) | undefined;
	}

	let { active, finished, nowMs, onopen }: Props = $props();
</script>

{#if active.length > 0}
	<ul aria-label="Jobs in progress">
		{#each active as run (run.id)}
			<li><JobRunRow {run} {nowMs} {onopen} /></li>
		{/each}
	</ul>
{/if}
{#if finished.length > 0}
	<p
		class={[
			'text-fg-tertiary text-3xs px-2 pb-1 font-medium tracking-wide uppercase',
			active.length > 0 ? 'pt-2' : 'pt-1',
		]}
		aria-hidden="true"
	>
		Recent
	</p>
	<ul aria-label="Recent jobs">
		{#each finished as run (run.id)}
			<li><JobRunRow {run} {nowMs} {onopen} /></li>
		{/each}
	</ul>
{/if}
