<script lang="ts">
	import type { RunGroup } from '../render-state';
	import type { RunTimelineItem } from '../run-timeline';
	import ActivityMessageRow from './ActivityMessageRow.svelte';
	import ChatTimelineRow from './ChatTimelineRow.svelte';
	import { transcriptContext } from './transcript-context';
	import { estimateRowHeight, rowsFillingDown } from './transcript-estimates';
	import TranscriptRow from './TranscriptRow.svelte';
	import { rowWindowKey } from './transcript-window.svelte';

	interface Props {
		rows: readonly RunTimelineItem[];
		run: RunGroup;
		isLastRun: boolean;
	}

	let { rows, run, isLastRun }: Props = $props();

	const OPENED_VIEWPORTS = 2;
	const transcriptWindow = transcriptContext().window;
	const mountedOnOpen = $derived(
		rowsFillingDown(run.runId, rows, 0, globalThis.innerHeight * OPENED_VIEWPORTS, transcriptWindow)
			.keys,
	);
</script>

{#each rows as row (row.key)}
	<TranscriptRow
		rowKey={rowWindowKey(run.runId, row.key)}
		initiallyMounted={mountedOnOpen.has(row.key)}
		estimate={() => estimateRowHeight(row, transcriptWindow.textWidth)}
	>
		{#if row.kind === 'assistant'}
			<ActivityMessageRow message={row} {run} />
		{:else}
			<ChatTimelineRow item={row} {run} {isLastRun} />
		{/if}
	</TranscriptRow>
{/each}
