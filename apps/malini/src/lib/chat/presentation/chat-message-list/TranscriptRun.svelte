<script module lang="ts">
	import type { StreamingBlock } from '$lib/chat/domain/streaming-block';
	import type { RunTimelineItem } from '../run-timeline';

	export type LiveRunBlocks = Readonly<{
		pendingItems: readonly RunTimelineItem[];
		assistant: readonly StreamingBlock[];
	}>;
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import type { GroupedRunTimelineItem } from '../activity-group';
	import BufferedStreamingMarkdown from '../BufferedStreamingMarkdown.svelte';
	import { runLastSeq, type RunGroup } from '../render-state';
	import RunStatusLine from '../RunStatusLine.svelte';
	import ChatActivityGroup from './ChatActivityGroup.svelte';
	import ChatTimelineRow from './ChatTimelineRow.svelte';
	import RunTerminalBanner from './RunTerminalBanner.svelte';
	import RunUndoFooter from './RunUndoFooter.svelte';
	import { blockKey } from './streaming-finalization';
	import { RUN_TIMELINE_REVEAL_INCREMENT } from './timeline-derivations.svelte';
	import { transcriptContext } from './transcript-context';
	import {
		anchoredRowStart,
		estimateRowHeight,
		estimateRunHeight,
		rowsFillingDown,
	} from './transcript-estimates';
	import TranscriptRow from './TranscriptRow.svelte';
	import { rowWindowKey, runWindowKey } from './transcript-window.svelte';

	interface Props {
		run: RunGroup;
		isLastRun: boolean;
		live: LiveRunBlocks | null;
		copied: boolean;
	}

	let { run, isLastRun, live, copied }: Props = $props();

	const transcript = transcriptContext();
	const { timelines, stageEnter, timelineKey } = transcript;
	const transcriptWindow = transcript.window;

	const runKey = $derived(runWindowKey(run.runId));
	const opening = $derived(run.items.find((item) => item.kind === 'user'));
	const editing = $derived(
		opening?.kind === 'user' &&
			opening.checkpointId !== undefined &&
			transcript.checkpointEdit.editingCheckpointId === opening.checkpointId,
	);
	const initiallyMounted = untrack(() => isLastRun || transcript.openingBudget(run.runId) > 0);
	const mounted = $derived(
		isLastRun || editing || transcriptWindow.mounted(runKey, initiallyMounted),
	);
	const placeholderHeight = $derived(
		mounted
			? null
			: (transcriptWindow.heightOf(runKey) ?? estimateRunHeight(run, transcriptWindow.textWidth)),
	);

	const runTimelineWindow = $derived(timelines.timelineWindow(run));
	const runRows = $derived(timelines.groupedTimelineItems(run, runTimelineWindow, isLastRun));
	const runTimelineItems = $derived(
		live && live.pendingItems.length > 0 ? mergePendingRows(runRows, live.pendingItems) : runRows,
	);
	const undoTarget = $derived(
		!run.superseded && !run.obsoleted ? transcript.undoTarget(run.runId) : null,
	);
	const forkSeq = $derived(runLastSeq(run));
	const forkAvailable = $derived(
		run.terminal !== null && !run.superseded && !run.obsoleted && forkSeq !== null,
	);
	const hasAssistantAnswer = $derived(
		timelines.timelineItems(run).some((item) => item.kind === 'assistant'),
	);
	const endsQuietly = $derived(
		run.terminal === 'cancelled' || (run.terminal === 'paused' && !isLastRun),
	);

	let rowsRendered = false;
	let seededRows: ReadonlySet<string> | null = null;

	$effect(() => {
		rowsRendered = mounted;
		if (!mounted) seededRows = null;
	});

	function rowKey(item: GroupedRunTimelineItem): string {
		return rowWindowKey(run.runId, item.key);
	}

	function rowInitiallyMounted(item: GroupedRunTimelineItem): boolean {
		if (rowsRendered) return true;
		seededRows ??= untrack(() => seedRows(runTimelineItems));
		return seededRows.has(item.key);
	}

	function seedRows(rows: readonly GroupedRunTimelineItem[]): ReadonlySet<string> {
		if (isLastRun && transcript.listRendered()) return new Set(rows.map((row) => row.key));
		const budget = transcript.openingBudget(run.runId);
		const anchor = transcript.openingAnchor;
		if (anchor) {
			const from = anchor.runId === run.runId ? anchoredRowStart(anchor) : 0;
			return rowsFillingDown(run.runId, rows, from, budget, transcriptWindow).keys;
		}
		const seeded = new Set<string>();
		let height = 0;
		for (let index = rows.length - 1; index >= 0 && height < budget; index -= 1) {
			const row = rows[index];
			if (!row) continue;
			seeded.add(row.key);
			height +=
				transcriptWindow.heightOf(rowKey(row)) ??
				estimateRowHeight(row, transcriptWindow.textWidth);
		}
		return seeded;
	}

	function mergePendingRows(
		rows: readonly GroupedRunTimelineItem[],
		pending: readonly RunTimelineItem[],
	): readonly GroupedRunTimelineItem[] {
		const drawn = new Set(rows.map((row) => row.key));
		const fresh = pending.filter((row) => !drawn.has(row.key));
		return fresh.length > 0 ? [...rows, ...fresh] : rows;
	}

	function onShowOlder(event: MouseEvent): void {
		const row =
			event.currentTarget instanceof Element
				? event.currentTarget.closest('li')?.querySelector<HTMLElement>('[data-transcript-row]')
				: null;
		void transcript.showOlderTimeline(run.runId, row ?? null);
	}

	function promptLabel(): string | undefined {
		return opening?.kind === 'user' ? opening.text : undefined;
	}
</script>

{#snippet runActions()}
	<RunUndoFooter {run} target={undoTarget} forkAtSeq={forkAvailable ? forkSeq : null} />
	{@render copyResponse()}
{/snippet}

{#snippet copyResponse()}
	<Tooltip content={copied ? 'Copied' : 'Copy response'} placement="top">
		<IconButton
			bare
			class="text-fg-tertiary hover:text-fg-secondary focus-visible:ring-border-default/50 grid h-5 w-5 cursor-pointer place-items-center rounded opacity-0 transition-opacity group-hover/run:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none"
			ariaLabel="Copy response"
			data-testid="chat-copy-response"
			data-copy-run-id={run.runId}
			onclick={() => transcript.copyRunResponse(run)}
		>
			<Icon name="copy" size={14} />
		</IconButton>
	</Tooltip>
{/snippet}

<li
	class={[
		'group/run relative flex flex-col gap-2',
		!isLastRun && run.terminal !== null && 'opacity-90',
		run.superseded && 'pointer-events-none opacity-50 select-none',
	]}
	style:height={placeholderHeight === null ? undefined : `${placeholderHeight}px`}
	aria-label={mounted ? undefined : promptLabel()}
	data-run-id={run.runId}
	data-run-terminal={run.terminal ?? 'open'}
	data-transcript-placeholder={mounted ? undefined : ''}
	data-transcript-total-items={mounted ? timelines.timelineItems(run).length : undefined}
	data-transcript-mounted-items={mounted ? runTimelineWindow.items.length : undefined}
	{@attach transcriptWindow.track(runKey)}
	{@attach isLastRun ? transcript.glideRowLayout : undefined}
>
	{#if mounted}
		{#if runTimelineWindow.hiddenCount > 0}
			<div class="flex justify-center pb-1">
				<Button
					variant="secondary"
					size="sm"
					bordered
					class="border-chip-border bg-chip hover:bg-chip-hover h-8 px-3"
					data-testid="chat-show-older-activity"
					data-run-id={run.runId}
					onclick={onShowOlder}
				>
					Show {Math.min(RUN_TIMELINE_REVEAL_INCREMENT, runTimelineWindow.hiddenCount)} older events
				</Button>
			</div>
		{/if}

		{#each runTimelineItems as item (item.key)}
			{#if item.kind === 'user'}
				<ChatTimelineRow {item} {run} {isLastRun} />
			{:else}
				<TranscriptRow
					rowKey={rowKey(item)}
					initiallyMounted={rowInitiallyMounted(item)}
					estimate={() => estimateRowHeight(item, transcriptWindow.textWidth)}
				>
					{#if item.kind === 'activity-group'}
						<ChatActivityGroup group={item} {run} {isLastRun} />
					{:else if item.kind === 'workstreams'}
						<div
							class="w-full"
							use:stageEnter={timelineKey(run, item.key)}
							data-message-kind="workstreams"
						>
							{@render transcript.workstreamsCard(item.workstreamIds)}
						</div>
					{:else}
						<ChatTimelineRow {item} {run} {isLastRun} />
					{/if}
				</TranscriptRow>
			{/if}
		{/each}

		{#if live}
			{#each live.assistant as block (block.contentId)}
				<div
					class="text-fg-default w-full text-sm leading-relaxed"
					use:stageEnter={blockKey(transcript.sessionId, block.runId, block.contentId)}
					data-message-kind="assistant-live"
					data-testid="chat-message-bubble-live"
				>
					<BufferedStreamingMarkdown
						text={block.text}
						class="select-text"
						playbackKey={blockKey(transcript.sessionId, block.runId, block.contentId)}
						flush={!isLastRun}
						revealOnMount={!transcript.transcriptSettled()}
						onopenfile={transcript.openFileMention}
						canopenfile={transcript.canOpenFileMention}
						imagesrc={transcript.markdownImageSource}
					/>
				</div>
			{/each}
		{/if}

		{#if endsQuietly}
			<div class="flex h-6 items-center gap-1.5" data-testid="chat-run-actions">
				<RunTerminalBanner {run} />
				{#if hasAssistantAnswer || undoTarget || forkAvailable}
					{@render runActions()}
				{/if}
			</div>
		{:else if isLastRun || run.terminal === null}
			<RunStatusLine
				{run}
				waitingForUser={isLastRun && transcript.waitingForUser}
				background={transcript.backgroundWork}
			>
				{#if hasAssistantAnswer}
					{@render copyResponse()}
				{/if}
			</RunStatusLine>
		{/if}

		{#if run.terminal === 'failed' || (run.terminal === 'paused' && isLastRun)}
			<RunTerminalBanner {run} latest={isLastRun} />
		{/if}

		{#if run.obsoleted}
			<p class="text-2xs text-fg-tertiary" data-testid="chat-run-obsoleted-note">
				Files from this run were reverted by an undo in another chat
			</p>
		{/if}

		{#if run.terminal !== null && !endsQuietly && (hasAssistantAnswer || undoTarget || forkAvailable)}
			<div class="flex h-6 items-center justify-end gap-1.5" data-testid="chat-run-actions">
				{@render runActions()}
			</div>
		{/if}
	{/if}
</li>
