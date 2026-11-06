<script lang="ts">
	import { quartOut } from 'svelte/easing';
	import { prefersReducedMotion } from 'svelte/motion';
	import { slide } from 'svelte/transition';
	import { stopBackgroundTaskCommand } from '$lib/chat/application/commands/stop-background-task.command';
	import { agentTaskOf } from '$lib/chat/domain/background-work';
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { ShimmerText } from '$hyper-ui/components/shimmer-text';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { motionMs, revealFade } from '../arrival-motion';
	import ExpandMark from '../ExpandMark.svelte';
	import MarkdownText from '../MarkdownText.svelte';
	import ToolLabel from '../ToolLabel.svelte';
	import { formatToolDuration, toolDurationMs, type RunGroup } from '../render-state';
	import type { SubagentTimelineItem } from '../run-timeline';
	import { isBackgroundAgent } from '../tool-display-name';
	import ChatToolRow from './ChatToolRow.svelte';
	import {
		elapsedSeconds,
		stepCount,
		subagentPrompt,
		subagentResult,
		subagentTicker,
		subagentTitle,
	} from './subagent-row-model';
	import { transcriptContext } from './transcript-context';

	interface Props {
		item: SubagentTimelineItem;
		run: RunGroup;
	}

	let { item, run }: Props = $props();

	const transcript = transcriptContext();
	const { stageEnter, timelineKey, expandedActivityGroups } = transcript;
	const expanded = $derived(expandedActivityGroups[item.key] === true);
	const running = $derived(item.tool.status === 'running');
	const title = $derived(subagentTitle(item));
	const ticker = $derived(subagentTicker(item));
	const durationMs = $derived(toolDurationMs(item.tool));
	const task = $derived(
		running ? agentTaskOf(transcript.backgroundWork, item.tool.toolCallId) : null,
	);
	let nowMs = $state(Date.now());
	let stopping = $state(false);
	const timing = $derived.by(() => {
		if (running) {
			return transcript.waitingForUser ? 'waiting' : elapsedSeconds(item.tool.startedAt, nowMs);
		}
		return durationMs === null ? null : formatToolDuration(durationMs);
	});
	const meta = $derived(
		[stepCount(item.steps.length), timing].filter((part) => part !== null).join(' · '),
	);
	const prompt = $derived(expanded ? subagentPrompt(item) : null);
	const result = $derived(expanded && !running ? subagentResult(item) : null);

	$effect(() => {
		if (!running) return;
		nowMs = Date.now();
		const clock = setInterval(() => (nowMs = Date.now()), 1_000);
		return () => clearInterval(clock);
	});

	function stop(taskId: string): void {
		stopping = true;
		stopBackgroundTaskCommand(transcript.sessionId, taskId);
	}
</script>

<div
	class="w-full text-sm"
	use:stageEnter={timelineKey(run, item.tool.toolCallId ?? item.key)}
	data-message-kind="subagent"
	data-tool-status={item.tool.status}
	data-testid="subagent-row"
>
	<div class="flex items-center gap-1">
		<Button
			bare
			class="group/expand text-fg-tertiary hover:text-fg-secondary focus-visible:ring-border-default/50 flex min-h-6 min-w-0 flex-1 cursor-pointer items-center gap-2 bg-transparent text-left transition-[color,border-color] focus-visible:ring-2 focus-visible:outline-none"
			ariaExpanded={expanded}
			data-testid="subagent-summary"
			onclick={() => (expandedActivityGroups[item.key] = !expanded)}
		>
			<ExpandMark>
				{#if running}
					<BusyIcon size={14} background={isBackgroundAgent(item.tool.name, item.tool.input)} />
				{:else if item.tool.status === 'failed'}
					<Icon name="warning" size={14} class="text-error-content shrink-0" />
				{:else}
					<Icon name="workflow" size={14} class="shrink-0" />
				{/if}
			</ExpandMark>
			<span class="text-fg-secondary max-w-1/2 shrink-0 truncate" data-testid="subagent-title">
				{#if running}
					<ShimmerText text={title} />
				{:else}
					<SensitiveText text={title} />
				{/if}
			</span>
			<span
				class="text-fg-tertiary/75 flex min-w-0 flex-1 transition-[opacity,visibility] duration-200 group-aria-expanded/expand:invisible group-aria-expanded/expand:opacity-0"
				data-testid="subagent-ticker"
			>
				<ToolLabel title={ticker ?? ''} />
			</span>
			{#if meta}
				<span
					class="text-3xs text-fg-tertiary/70 shrink-0 font-mono tabular-nums"
					data-testid="subagent-meta"
					in:revealFade
				>
					{meta}
				</span>
			{/if}
		</Button>
		{#if task}
			<Tooltip content="Stop this task" placement="top">
				<IconButton
					variant="ghost"
					size="xs"
					class="text-fg-tertiary"
					ariaLabel={`Stop ${title}`}
					disabled={stopping}
					onclick={() => stop(task.taskId)}
				>
					<Icon name="stop" size={12} />
				</IconButton>
			</Tooltip>
		{:else}
			<span class="w-5 shrink-0" aria-hidden="true"></span>
		{/if}
	</div>
	{#if expanded}
		<div
			class="border-surface-100-border mt-1 mb-2 ml-1.5 flex flex-col gap-2 border-l pl-3.5"
			data-testid="subagent-steps"
			transition:slide={{
				duration: prefersReducedMotion.current ? 0 : motionMs(240),
				easing: quartOut,
			}}
		>
			{#if prompt}
				<ScrollableDiv class="bg-surface-50 max-h-52 rounded" viewportClass="max-h-52">
					<p
						class="text-2xs text-fg-secondary px-2 py-1.5 leading-relaxed break-words whitespace-pre-wrap select-text"
						data-testid="subagent-prompt"
					>
						<SensitiveText text={prompt} />
					</p>
				</ScrollableDiv>
			{/if}
			{#each item.steps as step (step.key)}
				<ChatToolRow item={step} {run} />
			{/each}
			{#if result}
				<div
					class="text-fg-secondary text-sm leading-relaxed select-text"
					data-testid="subagent-result"
					in:revealFade
				>
					<MarkdownText
						text={result}
						onopenfile={transcript.openFileMention}
						canopenfile={transcript.canOpenFileMention}
					/>
				</div>
			{/if}
		</div>
	{/if}
</div>
